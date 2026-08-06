/** Session-bound asynchronous Runtime IPC request, response, and notification Peer. */
import type { JsonValue } from "../../../event/protocol/index.js";
import { noopLogger, type Logger } from "../../../observability/index.js";
import {
  RUNTIME_IPC_FRAME_TYPE,
  RUNTIME_IPC_PROTOCOL_VERSION,
  RuntimeIpcRemoteError,
  captureRuntimeIpcErrorSnapshot,
  captureRuntimeIpcFrame,
  sameRuntimeIpcRequest,
  type RuntimeIpcErrorSnapshot,
  type RuntimeIpcFrame,
  type RuntimeIpcNotificationFrame,
  type RuntimeIpcRequestFrame,
  type RuntimeIpcResponseFrame,
} from "../protocol/index.js";
import type { RuntimeIpcConnection } from "./RuntimeIpcConnection.js";
import {
  RuntimeIpcBackpressureError,
  RuntimeIpcPeerClosedError,
  RuntimeIpcPeerStateError,
  RuntimeIpcRequestCancelledError,
  RuntimeIpcSessionMismatchError,
  type RuntimeIpcQueueLane,
} from "./RuntimeIpcPeerErrors.js";

export const RUNTIME_IPC_CANCEL_REQUEST_METHOD = "ipc.cancel_request" as const;

export interface RuntimeIpcRequestHandlerContext {
  readonly sessionId: string;
  readonly requestId: string;
  readonly signal: AbortSignal;
}

export interface RuntimeIpcRequestHandler {
  handle(
    method: string,
    payload: JsonValue,
    context: RuntimeIpcRequestHandlerContext,
  ): Promise<JsonValue>;
}

export interface RuntimeIpcNotificationHandler {
  handle(method: string, payload: JsonValue): Promise<void>;
}

export interface RuntimeIpcRequestErrorMapper {
  map(error: unknown, context: RuntimeIpcRequestHandlerContext): RuntimeIpcErrorSnapshot;
}

export interface RuntimeIpcIdentityFactory {
  create(): string;
}

export interface RuntimeIpcRequestOptions {
  readonly signal?: AbortSignal;
  readonly lane?: RuntimeIpcQueueLane;
}

export interface RuntimeIpcNotificationOptions {
  readonly lane?: RuntimeIpcQueueLane;
}

export interface RuntimeIpcPeerOptions {
  readonly sessionId: string;
  readonly connection: RuntimeIpcConnection;
  readonly requestHandler?: RuntimeIpcRequestHandler;
  readonly notificationHandler?: RuntimeIpcNotificationHandler;
  readonly requestErrorMapper?: RuntimeIpcRequestErrorMapper;
  readonly requestIdFactory?: RuntimeIpcIdentityFactory;
  readonly notificationIdFactory?: RuntimeIpcIdentityFactory;
  readonly completionLedgerCapacity?: number;
  readonly controlQueueCapacity?: number;
  readonly dataQueueCapacity?: number;
  readonly logger?: Logger;
}

type RuntimeIpcPeerState = "created" | "running" | "closing" | "closed";

interface PendingRequest {
  readonly requestId: string;
  readonly resolve: (value: JsonValue) => void;
  readonly reject: (error: unknown) => void;
  readonly removeAbort: () => void;
}

interface ActiveInboundRequest {
  readonly request: RuntimeIpcRequestFrame;
  readonly controller: AbortController;
}

interface CompletedInboundRequest {
  readonly request: RuntimeIpcRequestFrame;
  readonly response: RuntimeIpcResponseFrame;
}

interface OutboundItem {
  readonly frame: RuntimeIpcFrame;
  readonly lane: RuntimeIpcQueueLane;
  readonly resolve: () => void;
  readonly reject: (error: unknown) => void;
}

const DEFAULT_COMPLETION_LEDGER_CAPACITY = 1024;
const DEFAULT_CONTROL_QUEUE_CAPACITY = 64;
const DEFAULT_DATA_QUEUE_CAPACITY = 1024;

export class RuntimeIpcPeer {
  readonly #sessionId: string;
  readonly #connection: RuntimeIpcConnection;
  readonly #requestHandler?: RuntimeIpcRequestHandler;
  readonly #notificationHandler?: RuntimeIpcNotificationHandler;
  readonly #requestErrorMapper: RuntimeIpcRequestErrorMapper;
  readonly #requestIdFactory: RuntimeIpcIdentityFactory;
  readonly #notificationIdFactory: RuntimeIpcIdentityFactory;
  readonly #completionLedgerCapacity: number;
  readonly #controlQueueCapacity: number;
  readonly #dataQueueCapacity: number;
  readonly #logger: Logger;
  readonly #pending = new Map<string, PendingRequest>();
  readonly #activeInbound = new Map<string, ActiveInboundRequest>();
  readonly #completedInbound = new Map<string, CompletedInboundRequest>();
  readonly #controlQueue: OutboundItem[] = [];
  readonly #dataQueue: OutboundItem[] = [];
  readonly #closedPromise: Promise<void>;
  #resolveClosed!: () => void;
  #state: RuntimeIpcPeerState = "created";
  #draining = false;
  #closePromise?: Promise<void>;

  constructor(options: RuntimeIpcPeerOptions) {
    this.#sessionId = captureIdentity(options.sessionId, "Runtime IPC session ID");
    this.#connection = options.connection;
    this.#requestHandler = options.requestHandler;
    this.#notificationHandler = options.notificationHandler;
    this.#requestErrorMapper = options.requestErrorMapper ?? DEFAULT_ERROR_MAPPER;
    this.#requestIdFactory = options.requestIdFactory ?? createCounterFactory(
      `request-${this.#sessionId}`,
    );
    this.#notificationIdFactory = options.notificationIdFactory ?? createCounterFactory(
      `notification-${this.#sessionId}`,
    );
    this.#completionLedgerCapacity = captureCapacity(
      options.completionLedgerCapacity ?? DEFAULT_COMPLETION_LEDGER_CAPACITY,
      "Runtime IPC completion ledger capacity",
    );
    this.#controlQueueCapacity = captureCapacity(
      options.controlQueueCapacity ?? DEFAULT_CONTROL_QUEUE_CAPACITY,
      "Runtime IPC control queue capacity",
    );
    this.#dataQueueCapacity = captureCapacity(
      options.dataQueueCapacity ?? DEFAULT_DATA_QUEUE_CAPACITY,
      "Runtime IPC data queue capacity",
    );
    this.#logger = (options.logger ?? noopLogger).child({
      component: "runtime_ipc_peer",
      sessionId: this.#sessionId,
    });
    this.#closedPromise = new Promise((resolve) => {
      this.#resolveClosed = resolve;
    });
  }

  get state(): RuntimeIpcPeerState {
    return this.#state;
  }

  start(): void {
    if (this.#state !== "created") throw new RuntimeIpcPeerStateError(this.#state);
    this.#state = "running";
    this.#logger.info("runtime.ipc.peer_started");
    void this.#receiveLoop();
  }

  request<TData extends JsonValue = JsonValue>(
    methodSource: string,
    payload: JsonValue,
    options: RuntimeIpcRequestOptions = {},
  ): Promise<TData> {
    try {
      this.#assertRunning();
    } catch (error) {
      this.#logger.error("runtime.ipc.request_state_invalid", {
        method: methodSource,
        state: this.#state,
        errorName: error instanceof Error ? error.name : typeof error,
        ...(error instanceof Error && "code" in error
          ? { errorCode: String((error as { code: unknown }).code) }
          : {}),
      });
      throw error;
    }
    this.#logger.debug("runtime.ipc.request_started", {
      method: methodSource,
      state: this.#state,
    });
    const requestId = captureIdentity(
      this.#requestIdFactory.create(),
      "Runtime IPC request ID",
    );
    if (this.#pending.has(requestId)) {
      return Promise.reject(new TypeError("Runtime IPC request ID is already pending"));
    }
    const signal = captureOptionalSignal(options.signal);
    if (signal?.aborted) {
      return Promise.reject(new RuntimeIpcRequestCancelledError(requestId));
    }
    const frame = captureRuntimeIpcFrame({
      frameType: RUNTIME_IPC_FRAME_TYPE.request,
      protocolVersion: RUNTIME_IPC_PROTOCOL_VERSION,
      sessionId: this.#sessionId,
      requestId,
      method: methodSource,
      payload,
    });
    if (frame.frameType !== "request") throw new TypeError("Runtime IPC request is invalid");

    return new Promise<TData>((resolve, reject) => {
      const onAbort = (): void => {
        const pending = this.#pending.get(requestId);
        if (!pending) return;
        this.#pending.delete(requestId);
        pending.removeAbort();
        pending.reject(new RuntimeIpcRequestCancelledError(requestId));
        void this.#sendCancellation(requestId);
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      const removeAbort = (): void => signal?.removeEventListener("abort", onAbort);
      this.#pending.set(requestId, {
        requestId,
        resolve: (value) => resolve(value as TData),
        reject,
        removeAbort,
      });
      this.#enqueue(frame, options.lane ?? "data").catch((error) => {
        const pending = this.#pending.get(requestId);
        if (!pending) return;
        this.#pending.delete(requestId);
        pending.removeAbort();
        this.#logger.error("runtime.ipc.request_enqueue_failed", {
          requestId,
          method: frame.method,
          state: this.#state,
          errorName: error instanceof Error ? error.name : typeof error,
          ...(error instanceof Error && "code" in error
            ? { errorCode: String((error as { code: unknown }).code) }
            : {}),
        });
        pending.reject(error);
      });
      this.#logger.debug("runtime.ipc.request_enqueued", {
        requestId,
        method: frame.method,
        lane: options.lane ?? "data",
      });
    });
  }

  async notify(
    methodSource: string,
    payload: JsonValue,
    options: RuntimeIpcNotificationOptions = {},
  ): Promise<void> {
    this.#assertRunning();
    const frame = captureRuntimeIpcFrame({
      frameType: RUNTIME_IPC_FRAME_TYPE.notification,
      protocolVersion: RUNTIME_IPC_PROTOCOL_VERSION,
      sessionId: this.#sessionId,
      notificationId: captureIdentity(
        this.#notificationIdFactory.create(),
        "Runtime IPC notification ID",
      ),
      method: methodSource,
      payload,
    });
    await this.#enqueue(frame, options.lane ?? "data");
  }

  waitForClose(): Promise<void> {
    return this.#closedPromise;
  }

  close(): Promise<void> {
    this.#closePromise ??= this.#closeOnce();
    return this.#closePromise;
  }

  async #closeOnce(): Promise<void> {
    if (this.#state === "closed") return;
    this.#state = "closing";
    this.#logger.info("runtime.ipc.peer_close_started");
    await this.#terminate(new RuntimeIpcPeerClosedError(), true);
    this.#logger.info("runtime.ipc.peer_close_completed");
  }

  async #receiveLoop(): Promise<void> {
    try {
      for await (const frameSource of this.#connection) {
        if (this.#state !== "running") break;
        const frame = captureRuntimeIpcFrame(frameSource);
        this.#assertSession(frame);
        switch (frame.frameType) {
          case "request":
            void this.#handleRequest(frame).catch((error) =>
              this.#terminate(normalizeCloseError(error), true)
            );
            break;
          case "response":
            this.#handleResponse(frame);
            break;
          case "notification":
            void this.#handleNotification(frame).catch((error) =>
              this.#terminate(normalizeCloseError(error), true)
            );
            break;
          default:
            throw new TypeError("Runtime IPC Peer received a handshake Frame after startup");
        }
      }
      if (this.#state === "running") {
        await this.#terminate(new RuntimeIpcPeerClosedError(), false);
      }
    } catch (error) {
      await this.#terminate(normalizeCloseError(error), true);
    }
  }

  async #handleRequest(request: RuntimeIpcRequestFrame): Promise<void> {
    const completed = this.#completedInbound.get(request.requestId);
    if (completed) {
      if (!sameRuntimeIpcRequest(completed.request, request)) {
        await this.#rejectConflict(request);
        return;
      }
      this.#logger.debug("runtime.ipc.request_replayed", {
        requestId: request.requestId,
        method: request.method,
      });
      await this.#enqueue(completed.response, "control");
      return;
    }
    const active = this.#activeInbound.get(request.requestId);
    if (active) {
      if (!sameRuntimeIpcRequest(active.request, request)) {
        await this.#rejectConflict(request);
      }
      return;
    }

    const controller = new AbortController();
    const context = Object.freeze({
      sessionId: this.#sessionId,
      requestId: request.requestId,
      signal: controller.signal,
    });
    this.#activeInbound.set(request.requestId, { request, controller });
    this.#logger.debug("runtime.ipc.request_received", {
      requestId: request.requestId,
      method: request.method,
    });

    let response: RuntimeIpcResponseFrame;
    try {
      if (!this.#requestHandler) {
        response = this.#failureResponse(request.requestId, {
          code: "IPC_METHOD_NOT_FOUND",
          category: "validation",
          retryable: false,
        });
      } else {
        const data = await this.#requestHandler.handle(
          request.method,
          request.payload,
          context,
        );
        response = this.#successResponse(request.requestId, data);
      }
    } catch (error) {
      response = this.#failureResponse(
        request.requestId,
        controller.signal.aborted
          ? {
              code: "IPC_REQUEST_CANCELLED",
              category: "cancelled",
              retryable: false,
            }
          : this.#requestErrorMapper.map(error, context),
      );
    } finally {
      this.#activeInbound.delete(request.requestId);
    }

    this.#recordCompleted(request, response);
    await this.#enqueue(response, "control");
  }

  #handleResponse(response: RuntimeIpcResponseFrame): void {
    const pending = this.#pending.get(response.requestId);
    if (!pending) {
      this.#logger.debug("runtime.ipc.response_ignored", {
        requestId: response.requestId,
      });
      return;
    }
    this.#pending.delete(response.requestId);
    pending.removeAbort();
    if (response.ok) pending.resolve(response.data);
    else pending.reject(new RuntimeIpcRemoteError(response.error));
  }

  async #handleNotification(notification: RuntimeIpcNotificationFrame): Promise<void> {
    if (notification.method === RUNTIME_IPC_CANCEL_REQUEST_METHOD) {
      const requestId = captureCancellationPayload(notification.payload);
      this.#activeInbound.get(requestId)?.controller.abort();
      this.#logger.debug("runtime.ipc.request_cancel_received", { requestId });
      return;
    }
    if (!this.#notificationHandler) return;
    try {
      await this.#notificationHandler.handle(notification.method, notification.payload);
    } catch (error) {
      this.#logger.warn("runtime.ipc.notification_handler_failed", {
        notificationId: notification.notificationId,
        method: notification.method,
        errorName: safeErrorName(error),
        errorCode: safeErrorCode(error),
      });
    }
  }

  async #rejectConflict(request: RuntimeIpcRequestFrame): Promise<void> {
    this.#logger.warn("runtime.ipc.request_conflict", {
      requestId: request.requestId,
      method: request.method,
    });
    await this.#enqueue(this.#failureResponse(request.requestId, {
      code: "IPC_REQUEST_CONFLICT",
      category: "conflict",
      retryable: false,
    }), "control");
    await this.#terminate(new RuntimeIpcPeerClosedError(), true);
  }

  async #sendCancellation(requestId: string): Promise<void> {
    if (this.#state !== "running") return;
    try {
      await this.notify(
        RUNTIME_IPC_CANCEL_REQUEST_METHOD,
        { requestId },
        { lane: "control" },
      );
    } catch {
      // The original request has already been locally cancelled.
    }
  }

  #successResponse(requestId: string, data: JsonValue): RuntimeIpcResponseFrame {
    const frame = captureRuntimeIpcFrame({
      frameType: RUNTIME_IPC_FRAME_TYPE.response,
      protocolVersion: RUNTIME_IPC_PROTOCOL_VERSION,
      sessionId: this.#sessionId,
      requestId,
      ok: true,
      data,
    });
    if (frame.frameType !== "response") throw new TypeError("Runtime IPC response is invalid");
    return frame;
  }

  #failureResponse(
    requestId: string,
    errorSource: RuntimeIpcErrorSnapshot,
  ): RuntimeIpcResponseFrame {
    const frame = captureRuntimeIpcFrame({
      frameType: RUNTIME_IPC_FRAME_TYPE.response,
      protocolVersion: RUNTIME_IPC_PROTOCOL_VERSION,
      sessionId: this.#sessionId,
      requestId,
      ok: false,
      error: captureRuntimeIpcErrorSnapshot(errorSource),
    });
    if (frame.frameType !== "response") throw new TypeError("Runtime IPC response is invalid");
    return frame;
  }

  #recordCompleted(
    request: RuntimeIpcRequestFrame,
    response: RuntimeIpcResponseFrame,
  ): void {
    this.#completedInbound.set(request.requestId, { request, response });
    while (this.#completedInbound.size > this.#completionLedgerCapacity) {
      const oldest = this.#completedInbound.keys().next().value as string | undefined;
      if (!oldest) break;
      this.#completedInbound.delete(oldest);
    }
  }

  #enqueue(frame: RuntimeIpcFrame, lane: RuntimeIpcQueueLane): Promise<void> {
    if (this.#state !== "running") return Promise.reject(new RuntimeIpcPeerClosedError());
    const queue = lane === "control" ? this.#controlQueue : this.#dataQueue;
    const capacity = lane === "control"
      ? this.#controlQueueCapacity
      : this.#dataQueueCapacity;
    if (queue.length >= capacity) {
      return Promise.reject(new RuntimeIpcBackpressureError(lane, capacity));
    }
    return new Promise<void>((resolve, reject) => {
      queue.push({ frame, lane, resolve, reject });
      void this.#drain();
    });
  }

  async #drain(): Promise<void> {
    if (this.#draining || this.#state !== "running") return;
    this.#draining = true;
    try {
      while (this.#state === "running") {
        const item = this.#controlQueue.shift() ?? this.#dataQueue.shift();
        if (!item) return;
        try {
          await this.#connection.send(item.frame);
          item.resolve();
        } catch (error) {
          this.#logger.error("runtime.ipc.frame_send_failed", {
            frameType: item.frame.frameType,
            errorName: error instanceof Error ? error.name : typeof error,
          });
          item.reject(normalizeCloseError(error));
          await this.#terminate(normalizeCloseError(error), true);
          return;
        }
      }
    } finally {
      this.#draining = false;
    }
  }

  #assertSession(frame: RuntimeIpcFrame): void {
    if (
      frame.frameType === "hello" ||
      frame.frameType === "welcome" ||
      frame.frameType === "rejected" ||
      frame.sessionId !== this.#sessionId
    ) {
      throw new RuntimeIpcSessionMismatchError(this.#sessionId);
    }
  }

  #assertRunning(): void {
    if (this.#state !== "running") throw new RuntimeIpcPeerStateError(this.#state);
  }

  async #terminate(error: Error, closeConnection: boolean): Promise<void> {
    if (this.#state === "closed") return;
    this.#logger.error("runtime.ipc.peer_terminated", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
    this.#state = "closing";
    for (const pending of this.#pending.values()) {
      pending.removeAbort();
      pending.reject(error);
    }
    this.#pending.clear();
    for (const active of this.#activeInbound.values()) active.controller.abort();
    this.#activeInbound.clear();
    for (const item of [...this.#controlQueue, ...this.#dataQueue]) item.reject(error);
    this.#controlQueue.length = 0;
    this.#dataQueue.length = 0;
    if (closeConnection) {
      try {
        await this.#connection.close();
      } catch {
        // Connection shutdown is best effort after Peer termination.
      }
    }
    this.#state = "closed";
    this.#resolveClosed();
    this.#logger.info("runtime.ipc.peer_closed", {
      errorName: safeErrorName(error),
      errorCode: safeErrorCode(error),
    });
  }
}

const DEFAULT_ERROR_MAPPER: RuntimeIpcRequestErrorMapper = Object.freeze({
  map(): RuntimeIpcErrorSnapshot {
    return Object.freeze({
      code: "IPC_REQUEST_HANDLER_FAILED",
      category: "internal",
      retryable: false,
    });
  },
});

function createCounterFactory(prefix: string): RuntimeIpcIdentityFactory {
  let counter = 0;
  return Object.freeze({
    create(): string {
      counter += 1;
      return `${prefix}-${counter}`;
    },
  });
}

function captureCancellationPayload(payload: JsonValue): string {
  if (
    payload === null ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    Object.keys(payload).length !== 1
  ) {
    throw new TypeError("Runtime IPC cancellation payload is invalid");
  }
  return captureIdentity(payload.requestId, "Runtime IPC cancelled request ID");
}

function captureIdentity(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value)
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function captureCapacity(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${label} must be positive`);
  }
  return value;
}

function captureOptionalSignal(value: AbortSignal | undefined): AbortSignal | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "object" ||
    typeof value.aborted !== "boolean" ||
    typeof value.addEventListener !== "function" ||
    typeof value.removeEventListener !== "function"
  ) {
    throw new TypeError("Runtime IPC request signal is invalid");
  }
  return value;
}

function normalizeCloseError(error: unknown): Error {
  return error instanceof Error ? error : new RuntimeIpcPeerClosedError();
}

function safeErrorName(error: unknown): string {
  if (!error || typeof error !== "object") return "UnknownError";
  const name = (error as { name?: unknown }).name;
  return typeof name === "string" && /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/.test(name)
    ? name
    : "UnknownError";
}

function safeErrorCode(error: unknown): string {
  if (!error || typeof error !== "object") return "UNKNOWN";
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && /^[A-Z][A-Z0-9_]{0,127}$/.test(code)
    ? code
    : "UNKNOWN";
}
