/** Child stdio entrypoint: Hello, Welcome, Session Peer, then Runtime RPC. */
import type { Readable, Writable } from "node:stream";
import { noopLogger, type Logger } from "../../../observability/index.js";
import {
  RUNTIME_IPC_FRAME_TYPE,
  RUNTIME_IPC_PROTOCOL_FAMILY,
  RUNTIME_IPC_PROTOCOL_VERSION,
  RUNTIME_IPC_SUPPORTED_PROTOCOL_RANGE,
  RuntimeIpcPeer,
  captureRuntimeIpcFrame,
  type RuntimeIpcConnection,
} from "../../../runtime/ipc/index.js";
import { NodeJsonlIpcConnection } from "../ipc/index.js";
import { ChildRuntimePersistenceClient } from "../persistence/index.js";
import type { RuntimeChildCompositionFactory } from "./RuntimeChildCompositionFactory.js";
import { RuntimeChildEndpoint } from "./RuntimeChildEndpoint.js";
import { RuntimeChildEntrypointError } from "./RuntimeChildErrors.js";

export interface RuntimeChildProcessNonceFactory {
  create(): string;
}

export interface RuntimeChildEntrypointOptions {
  readonly connection: RuntimeIpcConnection;
  readonly compositionFactory: RuntimeChildCompositionFactory;
  readonly processNonceFactory?: RuntimeChildProcessNonceFactory;
  readonly logger?: Logger;
}

export interface RuntimeChildEntrypointResult {
  readonly reason: "parent_closed" | "runtime_exited";
}

export class RuntimeChildEntrypoint {
  readonly #connection: RuntimeIpcConnection;
  readonly #compositionFactory: RuntimeChildCompositionFactory;
  readonly #processNonceFactory: RuntimeChildProcessNonceFactory;
  readonly #logger: Logger;

  constructor(options: RuntimeChildEntrypointOptions) {
    this.#connection = options.connection;
    this.#compositionFactory = options.compositionFactory;
    this.#processNonceFactory = options.processNonceFactory ?? DEFAULT_PROCESS_NONCE_FACTORY;
    this.#logger = (options.logger ?? noopLogger).child({
      component: "runtime_child_entrypoint",
    });
  }

  async run(): Promise<RuntimeChildEntrypointResult> {
    const processNonce = captureIdentity(
      this.#processNonceFactory.create(),
      "Runtime child process nonce",
    );
    await this.#connection.send(captureRuntimeIpcFrame({
      frameType: RUNTIME_IPC_FRAME_TYPE.hello,
      protocolFamily: RUNTIME_IPC_PROTOCOL_FAMILY,
      supportedProtocol: RUNTIME_IPC_SUPPORTED_PROTOCOL_RANGE,
      processNonce,
    }));
    const response = await this.#readHandshakeResponse();
    if (response.frameType === RUNTIME_IPC_FRAME_TYPE.rejected) {
      if (response.processNonce !== processNonce) {
        await this.#connection.close();
        throw new RuntimeChildEntrypointError("invalid_welcome");
      }
      await this.#connection.close();
      throw new RuntimeChildEntrypointError("rejected");
    }
    if (
      response.frameType !== RUNTIME_IPC_FRAME_TYPE.welcome ||
      response.protocolVersion !== RUNTIME_IPC_PROTOCOL_VERSION ||
      response.processNonce !== processNonce
    ) {
      await this.#connection.close();
      throw new RuntimeChildEntrypointError("invalid_welcome");
    }

    let peer: RuntimeIpcPeer | undefined;
    const persistence = new ChildRuntimePersistenceClient({
      requester: {
        request(method, payload, options) {
          if (peer === undefined) {
            throw new RuntimeChildEntrypointError("connection_closed");
          }
          return peer.request(method, payload, options);
        },
      },
      logger: this.#logger,
    });
    const endpoint = new RuntimeChildEndpoint({
      compositionFactory: this.#compositionFactory,
      compositionContext: Object.freeze({ persistence }),
      logger: this.#logger,
    });
    peer = new RuntimeIpcPeer({
      sessionId: response.sessionId,
      connection: this.#connection,
      requestHandler: endpoint,
      requestErrorMapper: endpoint,
      logger: this.#logger,
    });
    peer.start();
    this.#logger.info("runtime.child.session_started", {
      sessionId: response.sessionId,
    });

    const reason = await Promise.race([
      peer.waitForClose().then(() => "parent_closed" as const),
      endpoint.waitForUnexpectedExit().then(() => "runtime_exited" as const),
    ]);
    if (reason === "runtime_exited") await peer.close();
    await endpoint.close();
    this.#logger.info("runtime.child.entrypoint_completed", { reason });
    return Object.freeze({ reason });
  }

  async #readHandshakeResponse() {
    let result;
    try {
      result = await this.#connection.next();
    } catch {
      throw new RuntimeChildEntrypointError("connection_closed");
    }
    if (result.done) throw new RuntimeChildEntrypointError("connection_closed");
    return result.value;
  }
}

export interface RunNodeRuntimeChildEntrypointOptions {
  readonly compositionFactory: RuntimeChildCompositionFactory;
  readonly readable?: Readable;
  readonly writable?: Writable;
  readonly logger?: Logger;
}

export function runNodeRuntimeChildEntrypoint(
  options: RunNodeRuntimeChildEntrypointOptions,
): Promise<RuntimeChildEntrypointResult> {
  const connection = new NodeJsonlIpcConnection({
    readable: options.readable ?? process.stdin,
    writable: options.writable ?? process.stdout,
    logger: options.logger,
  });
  return new RuntimeChildEntrypoint({
    connection,
    compositionFactory: options.compositionFactory,
    logger: options.logger,
  }).run();
}

const DEFAULT_PROCESS_NONCE_FACTORY: RuntimeChildProcessNonceFactory = Object.freeze({
  create: () => `process-${globalThis.crypto.randomUUID().replaceAll("-", "")}`,
});

function captureIdentity(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value)
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}
