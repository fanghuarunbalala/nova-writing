/** Parent-side handshake and Runtime command endpoint over one IPC Session. */
import type {
  ConversationRuntimeBootstrap,
  ConversationRuntimeHandleShutdownRequest,
  ConversationRuntimeInputReference,
} from "../../../conversation/host/index.js";
import { noopLogger, type Logger } from "../../../observability/index.js";
import {
  RUNTIME_IPC_FRAME_TYPE,
  RUNTIME_IPC_PROTOCOL_FAMILY,
  RUNTIME_IPC_PROTOCOL_VERSION,
  RUNTIME_IPC_REJECTION_REASON,
  RUNTIME_IPC_SUPPORTED_PROTOCOL_RANGE,
  RuntimeIpcPeer,
  RuntimeIpcProtocolError,
  captureRuntimeIpcFrame,
  negotiateRuntimeIpcProtocolVersion,
  type RuntimeIpcConnection,
  type RuntimeIpcNotificationHandler,
  type RuntimeIpcRequestErrorMapper,
  type RuntimeIpcRequestHandler,
} from "../../../runtime/ipc/index.js";
import type {
  RuntimeChildProcessEndpoint,
} from "../process/ChildProcessConversationRuntimeHandle.js";
import type {
  RuntimeChildProcessEndpointFactory,
  RuntimeChildProcessEndpointFactoryRequest,
} from "../process/NodeConversationProcessSupervisor.js";
import {
  ParentRuntimeChildEndpointError,
  ParentRuntimeChildHandshakeError,
} from "./RuntimeChildErrors.js";
import {
  RUNTIME_CHILD_RPC_METHOD,
  captureRuntimeChildBootstrapAck,
  captureRuntimeChildCommandAck,
  encodeRuntimeChildBootstrap,
  encodeRuntimeChildInput,
  encodeRuntimeChildShutdown,
} from "./RuntimeChildProtocol.js";

export interface ParentRuntimeChildIdentityFactory {
  create(): string;
}

export interface ParentRuntimeChildEndpointFactoryOptions {
  readonly sessionIdFactory?: ParentRuntimeChildIdentityFactory;
  readonly requestHandler?: RuntimeIpcRequestHandler;
  readonly requestErrorMapper?: RuntimeIpcRequestErrorMapper;
  readonly notificationHandler?: RuntimeIpcNotificationHandler;
  readonly logger?: Logger;
}

export class ParentRuntimeChildEndpointFactory
  implements RuntimeChildProcessEndpointFactory
{
  readonly #sessionIdFactory: ParentRuntimeChildIdentityFactory;
  readonly #requestHandler?: RuntimeIpcRequestHandler;
  readonly #requestErrorMapper?: RuntimeIpcRequestErrorMapper;
  readonly #notificationHandler?: RuntimeIpcNotificationHandler;
  readonly #logger: Logger;

  constructor(options: ParentRuntimeChildEndpointFactoryOptions = {}) {
    this.#sessionIdFactory = options.sessionIdFactory ?? DEFAULT_SESSION_ID_FACTORY;
    this.#requestHandler = options.requestHandler;
    this.#requestErrorMapper = options.requestErrorMapper;
    this.#notificationHandler = options.notificationHandler;
    this.#logger = (options.logger ?? noopLogger).child({
      component: "parent_runtime_child_endpoint_factory",
    });
  }

  async connect(
    request: RuntimeChildProcessEndpointFactoryRequest,
  ): Promise<RuntimeChildProcessEndpoint> {
    const hello = await readHello(request.connection);
    let selectedVersion: number;
    try {
      selectedVersion = negotiateRuntimeIpcProtocolVersion(
        RUNTIME_IPC_SUPPORTED_PROTOCOL_RANGE,
        hello.supportedProtocol,
      );
    } catch (error) {
      if (!(error instanceof RuntimeIpcProtocolError)) throw error;
      await request.connection.send(captureRuntimeIpcFrame({
        frameType: RUNTIME_IPC_FRAME_TYPE.rejected,
        protocolFamily: RUNTIME_IPC_PROTOCOL_FAMILY,
        reason: RUNTIME_IPC_REJECTION_REASON.unsupportedVersion,
        supportedProtocol: RUNTIME_IPC_SUPPORTED_PROTOCOL_RANGE,
        processNonce: hello.processNonce,
      }));
      await request.connection.close();
      throw new ParentRuntimeChildHandshakeError("unsupported_protocol");
    }
    if (selectedVersion !== RUNTIME_IPC_PROTOCOL_VERSION) {
      await request.connection.close();
      throw new ParentRuntimeChildHandshakeError("unsupported_protocol");
    }

    const sessionId = captureIdentity(
      this.#sessionIdFactory.create(),
      "Runtime child Session ID",
    );
    await request.connection.send(captureRuntimeIpcFrame({
      frameType: RUNTIME_IPC_FRAME_TYPE.welcome,
      protocolVersion: RUNTIME_IPC_PROTOCOL_VERSION,
      sessionId,
      processNonce: hello.processNonce,
    }));
    const peer = new RuntimeIpcPeer({
      sessionId,
      connection: request.connection,
      ...(this.#requestHandler !== undefined
        ? { requestHandler: this.#requestHandler }
        : {}),
      ...(this.#requestErrorMapper !== undefined
        ? { requestErrorMapper: this.#requestErrorMapper }
        : {}),
      ...(this.#notificationHandler !== undefined
        ? { notificationHandler: this.#notificationHandler }
        : {}),
      logger: this.#logger,
    });
    peer.start();
    const endpoint = new ParentRuntimeChildEndpoint(peer, this.#logger);
    try {
      await endpoint.bootstrap(request.bootstrap);
      this.#logger.info("runtime.child.handshake_completed", {
        conversationId: request.bootstrap.conversation.metadata.id,
        runtimeInstanceId: request.bootstrap.runtimeInstanceId,
        sessionId,
      });
      return endpoint;
    } catch (error) {
      await endpoint.close();
      throw error;
    }
  }
}

export class ParentRuntimeChildEndpoint implements RuntimeChildProcessEndpoint {
  readonly #peer: RuntimeIpcPeer;
  readonly #logger: Logger;
  #closePromise?: Promise<void>;

  constructor(peer: RuntimeIpcPeer, logger: Logger = noopLogger) {
    this.#peer = peer;
    this.#logger = logger.child({ component: "parent_runtime_child_endpoint" });
  }

  async bootstrap(bootstrap: ConversationRuntimeBootstrap): Promise<void> {
    let response;
    try {
      response = await this.#peer.request(
        RUNTIME_CHILD_RPC_METHOD.bootstrap,
        encodeRuntimeChildBootstrap(bootstrap),
        { lane: "control" },
      );
    } catch {
      throw new ParentRuntimeChildEndpointError("bootstrap", "request_failed");
    }
    let acknowledgement;
    try {
      acknowledgement = captureRuntimeChildBootstrapAck(response);
    } catch {
      throw new ParentRuntimeChildEndpointError("bootstrap", "invalid_response");
    }
    if (
      acknowledgement.conversationId !== bootstrap.conversation.metadata.id ||
      acknowledgement.runtimeInstanceId !== bootstrap.runtimeInstanceId ||
      acknowledgement.throughSequence !== bootstrap.journal.highWatermark
    ) {
      throw new ParentRuntimeChildEndpointError("bootstrap", "identity_mismatch");
    }
  }

  async dispatchInput(input: ConversationRuntimeInputReference): Promise<void> {
    let response;
    try {
      response = await this.#peer.request(
        RUNTIME_CHILD_RPC_METHOD.dispatchInput,
        encodeRuntimeChildInput(input),
      );
    } catch {
      throw new ParentRuntimeChildEndpointError("dispatch_input", "request_failed");
    }
    try {
      captureRuntimeChildCommandAck(response);
    } catch {
      throw new ParentRuntimeChildEndpointError("dispatch_input", "invalid_response");
    }
  }

  async shutdown(request: ConversationRuntimeHandleShutdownRequest): Promise<void> {
    let response;
    try {
      response = await this.#peer.request(
        RUNTIME_CHILD_RPC_METHOD.shutdown,
        encodeRuntimeChildShutdown(request),
        { lane: "control" },
      );
    } catch {
      throw new ParentRuntimeChildEndpointError("shutdown", "request_failed");
    }
    try {
      captureRuntimeChildCommandAck(response);
    } catch {
      throw new ParentRuntimeChildEndpointError("shutdown", "invalid_response");
    }
    await this.close();
  }

  close(): Promise<void> {
    this.#closePromise ??= Promise.resolve().then(async () => {
      this.#logger.info("runtime.child.parent_endpoint_closed");
      await this.#peer.close();
    });
    return this.#closePromise;
  }
}

async function readHello(connection: RuntimeIpcConnection) {
  let result: IteratorResult<Awaited<ReturnType<typeof captureRuntimeIpcFrame>>>;
  try {
    result = await connection.next();
  } catch {
    throw new ParentRuntimeChildHandshakeError("invalid_hello");
  }
  if (result.done || result.value.frameType !== RUNTIME_IPC_FRAME_TYPE.hello) {
    await connection.close();
    throw new ParentRuntimeChildHandshakeError("invalid_hello");
  }
  return result.value;
}

const DEFAULT_SESSION_ID_FACTORY: ParentRuntimeChildIdentityFactory = Object.freeze({
  create: () => `session-${globalThis.crypto.randomUUID().replaceAll("-", "")}`,
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
