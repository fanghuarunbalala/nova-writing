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
  RuntimeIpcHeartbeatMonitor,
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
  RuntimeChildPayloadError,
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
    try {
      await request.connection.send(captureRuntimeIpcFrame({
        frameType: RUNTIME_IPC_FRAME_TYPE.welcome,
        protocolVersion: RUNTIME_IPC_PROTOCOL_VERSION,
        sessionId,
        processNonce: hello.processNonce,
      }));
    } catch (error) {
      this.#logger.error("runtime.child.welcome_send_failed", {
        errorName: error instanceof Error ? error.name : typeof error,
      });
      throw error;
    }
    this.#logger.info("runtime.child.welcome_sent", {
      sessionId,
      conversationId: request.bootstrap.conversation.metadata.id,
    });
    const heartbeatMonitor = new RuntimeIpcHeartbeatMonitor();
    const notificationHandler: RuntimeIpcNotificationHandler = {
      handle: async (method, payload) => {
        await heartbeatMonitor.handle(method, payload);
        if (method !== "runtime.heartbeat") {
          await this.#notificationHandler?.handle(method, payload);
        }
      },
    };
    const peer = new RuntimeIpcPeer({
      sessionId,
      connection: request.connection,
      ...(this.#requestHandler !== undefined
        ? { requestHandler: this.#requestHandler }
        : {}),
      ...(this.#requestErrorMapper !== undefined
        ? { requestErrorMapper: this.#requestErrorMapper }
        : {}),
      notificationHandler,
      logger: this.#logger,
    });
    peer.start();
    heartbeatMonitor.start();
    const endpoint = new ParentRuntimeChildEndpoint(peer, heartbeatMonitor, this.#logger);
    try {
      await endpoint.bootstrap(request.bootstrap);
      this.#logger.info("runtime.child.handshake_completed", {
        conversationId: request.bootstrap.conversation.metadata.id,
        runtimeInstanceId: request.bootstrap.runtimeInstanceId,
        sessionId,
      });
      return endpoint;
    } catch (error) {
      this.#logger.error("runtime.child.bootstrap_failed", {
        sessionId,
        errorName: error instanceof Error ? error.name : typeof error,
        ...(error instanceof ParentRuntimeChildEndpointError
          ? { failure: error.failure }
          : {}),
      });
      await endpoint.close();
      throw error;
    }
  }
}

export class ParentRuntimeChildEndpoint implements RuntimeChildProcessEndpoint {
  readonly #peer: RuntimeIpcPeer;
  readonly #heartbeatMonitor: RuntimeIpcHeartbeatMonitor;
  readonly #logger: Logger;
  #closePromise?: Promise<void>;

  constructor(peer: RuntimeIpcPeer, heartbeatMonitor: RuntimeIpcHeartbeatMonitor, logger: Logger = noopLogger) {
    this.#peer = peer;
    this.#heartbeatMonitor = heartbeatMonitor;
    this.#logger = logger.child({ component: "parent_runtime_child_endpoint" });
  }

  waitForUnhealthy(): Promise<void> { return this.#heartbeatMonitor.waitForUnhealthy(); }

  async bootstrap(bootstrap: ConversationRuntimeBootstrap): Promise<void> {
    this.#logger.info("runtime.child.bootstrap_request_started", {
      conversationId: bootstrap.conversation.metadata.id,
      runtimeInstanceId: bootstrap.runtimeInstanceId,
    });
    let payload;
    try {
      payload = encodeRuntimeChildBootstrap(bootstrap);
    } catch (error) {
      // 记录协议编码失败（稳定标识，不记录 payload 内容）。
      this.#logger.error("runtime.child.bootstrap_encode_failed", {
        conversationId: bootstrap.conversation.metadata.id,
        runtimeInstanceId: bootstrap.runtimeInstanceId,
        errorName: error instanceof Error ? error.name : typeof error,
        ...(error instanceof RuntimeChildPayloadError
          ? { payloadKind: error.payloadKind, errorCode: error.code }
          : {}),
      });
      throw new ParentRuntimeChildEndpointError("bootstrap", "request_failed");
    }
    let response;
    try {
      response = await this.#peer.request(
        RUNTIME_CHILD_RPC_METHOD.bootstrap,
        payload,
        { lane: "control" },
      );
    } catch {
      this.#logger.error("runtime.child.bootstrap_request_failed", {
        conversationId: bootstrap.conversation.metadata.id,
        runtimeInstanceId: bootstrap.runtimeInstanceId,
      });
      throw new ParentRuntimeChildEndpointError("bootstrap", "request_failed");
    }
    let acknowledgement;
    try {
      acknowledgement = captureRuntimeChildBootstrapAck(response);
    } catch {
      this.#logger.error("runtime.child.bootstrap_response_invalid", {
        conversationId: bootstrap.conversation.metadata.id,
        runtimeInstanceId: bootstrap.runtimeInstanceId,
      });
      throw new ParentRuntimeChildEndpointError("bootstrap", "invalid_response");
    }
    if (
      acknowledgement.conversationId !== bootstrap.conversation.metadata.id ||
      acknowledgement.runtimeInstanceId !== bootstrap.runtimeInstanceId ||
      acknowledgement.throughSequence !== bootstrap.journal.highWatermark
    ) {
      this.#logger.error("runtime.child.bootstrap_identity_mismatch", {
        conversationId: bootstrap.conversation.metadata.id,
        runtimeInstanceId: bootstrap.runtimeInstanceId,
      });
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
      this.#heartbeatMonitor.stop();
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
