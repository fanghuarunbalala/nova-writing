/** Browser WebSocket subscription half of the future composed ApiTransport. */
import {
  API_PROTOCOL_VERSION,
  ApiTransportDisconnectedError,
  ApiTransportError,
  noopLogger,
  type ApiEventFrame,
  type ApiRequest,
  type ApiSubscription,
  type ApiSubscriptionOptions,
  type Logger,
} from "@novel/core";
import {
  WEB_API_SUBSCRIPTION_PATH,
  WEB_API_WEBSOCKET_PROTOCOL,
  type WebSocketClientMessage,
} from "./WebSocketApiProtocol.js";

const SOCKET_CONNECTING = 0;
const SOCKET_OPEN = 1;

export interface BrowserWebSocketEventPort {
  readonly data?: unknown;
}

export type BrowserWebSocketListener = (
  event: BrowserWebSocketEventPort,
) => void;

export interface BrowserWebSocketPort {
  readonly readyState: number;
  readonly protocol: string;
  addEventListener(type: string, listener: BrowserWebSocketListener): void;
  removeEventListener(type: string, listener: BrowserWebSocketListener): void;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export type BrowserWebSocketFactory = (
  url: string,
  protocol: string,
) => BrowserWebSocketPort;

export interface WebSocketEventClientOptions {
  readonly origin: string | URL;
  readonly createSocket?: BrowserWebSocketFactory;
  readonly maxQueuedFrames?: number;
  readonly logger?: Logger;
}

export class WebSocketEventClient {
  readonly endpoint: string;

  private readonly createSocket: BrowserWebSocketFactory;
  private readonly maxQueuedFrames: number;
  private readonly logger: Logger;
  private readonly subscriptions = new Set<WebSocketApiSubscription>();
  private closed = false;
  private closePromise?: Promise<void>;

  constructor(options: WebSocketEventClientOptions) {
    this.endpoint = createSubscriptionEndpoint(options.origin);
    this.createSocket = options.createSocket ?? createNativeSocket;
    this.maxQueuedFrames = validateMaxQueuedFrames(
      options.maxQueuedFrames ?? 256,
    );
    this.logger = (options.logger ?? noopLogger).child({
      component: "websocket_event_client",
    });
  }

  subscribe(
    request: ApiRequest,
    options?: ApiSubscriptionOptions,
  ): ApiSubscription {
    if (this.closed) {
      throw new ApiTransportDisconnectedError("WebSocket Event client is closed");
    }
    throwIfAborted(options?.signal);
    const captured = validateRequest(request);
    const subscriptionId = `websocket:${captured.requestId}`;
    if ([...this.subscriptions].some((active) => active.id === subscriptionId)) {
      throw new ApiTransportError(
        "WEB_SOCKET_SUBSCRIPTION_DUPLICATE",
        false,
        "WebSocket subscription identity is already active",
      );
    }
    let subscription: WebSocketApiSubscription;
    let socket: BrowserWebSocketPort;
    try {
      socket = this.createSocket(this.endpoint, WEB_API_WEBSOCKET_PROTOCOL);
    } catch (error) {
      if (error instanceof ApiTransportError) throw error;
      throw new ApiTransportDisconnectedError(
        "WebSocket Event connection is unavailable",
      );
    }
    subscription = new WebSocketApiSubscription({
      id: subscriptionId,
      request: captured,
      socket,
      maxQueuedFrames: this.maxQueuedFrames,
      signal: options?.signal,
      logger: this.logger,
      onTerminated: () => this.subscriptions.delete(subscription),
    });
    this.subscriptions.add(subscription);
    this.logger.info("web_socket.subscription_created", {
      requestId: captured.requestId,
      operation: captured.operation,
      subscriptionId,
      subscriptionCount: this.subscriptions.size,
    });
    return subscription;
  }

  close(): Promise<void> {
    this.closePromise ??= this.closeOnce();
    return this.closePromise;
  }

  private async closeOnce(): Promise<void> {
    this.closed = true;
    const subscriptions = [...this.subscriptions];
    const results = await Promise.allSettled(
      subscriptions.map((subscription) => subscription.close()),
    );
    this.subscriptions.clear();
    const failureCount = results.filter(
      (result) => result.status === "rejected",
    ).length;
    this.logger.info("web_socket.client_closed", {
      subscriptionCount: subscriptions.length,
      failureCount,
    });
    if (failureCount > 0) {
      throw new ApiTransportError(
        "WEB_SOCKET_CLOSE_FAILED",
        true,
        "WebSocket Event client failed to close cleanly",
      );
    }
  }
}

interface WebSocketApiSubscriptionOptions {
  readonly id: string;
  readonly request: ApiRequest;
  readonly socket: BrowserWebSocketPort;
  readonly maxQueuedFrames: number;
  readonly signal?: AbortSignal;
  readonly logger: Logger;
  readonly onTerminated: () => void;
}

interface PendingRead {
  readonly resolve: (result: IteratorResult<ApiEventFrame>) => void;
  readonly reject: (error: unknown) => void;
}

class WebSocketApiSubscription implements ApiSubscription {
  readonly id: string;

  private readonly request: ApiRequest;
  private readonly socket: BrowserWebSocketPort;
  private readonly maxQueuedFrames: number;
  private readonly signal?: AbortSignal;
  private readonly logger: Logger;
  private readonly onTerminated: () => void;
  private readonly frames: ApiEventFrame[] = [];
  private readonly reads: PendingRead[] = [];
  private readonly removeAbortListener?: () => void;
  private opened = false;
  private done = false;
  private closed = false;
  private terminated = false;
  private failure?: unknown;
  private closePromise?: Promise<void>;

  constructor(options: WebSocketApiSubscriptionOptions) {
    this.id = options.id;
    this.request = options.request;
    this.socket = options.socket;
    this.maxQueuedFrames = options.maxQueuedFrames;
    this.signal = options.signal;
    this.logger = options.logger.child({ subscriptionId: this.id });
    this.onTerminated = options.onTerminated;
    this.socket.addEventListener("open", this.handleOpen);
    this.socket.addEventListener("message", this.handleMessage);
    this.socket.addEventListener("error", this.handleError);
    this.socket.addEventListener("close", this.handleClose);
    if (this.signal !== undefined) {
      const signal = this.signal;
      const abort = (): void => {
        this.fail(abortReason(signal), true);
      };
      signal.addEventListener("abort", abort, { once: true });
      this.removeAbortListener = () => signal.removeEventListener("abort", abort);
    }
  }

  async next(): Promise<IteratorResult<ApiEventFrame>> {
    if (this.failure !== undefined) throw this.failure;
    const frame = this.frames.shift();
    if (frame !== undefined) return { done: false, value: frame };
    if (this.done || this.closed) return { done: true, value: undefined };
    return new Promise<IteratorResult<ApiEventFrame>>((resolve, reject) => {
      this.reads.push({ resolve, reject });
    });
  }

  async return(): Promise<IteratorResult<ApiEventFrame>> {
    await this.close();
    return { done: true, value: undefined };
  }

  [Symbol.asyncIterator](): this {
    return this;
  }

  close(): Promise<void> {
    this.closePromise ??= this.closeOnce();
    return this.closePromise;
  }

  private readonly handleOpen = (): void => {
    if (this.closed || this.failure !== undefined) return;
    if (this.socket.protocol !== WEB_API_WEBSOCKET_PROTOCOL) {
      this.fail(protocolError(), true);
      return;
    }
    this.send({
      protocolVersion: API_PROTOCOL_VERSION,
      kind: "open",
      subscriptionId: this.id,
      request: this.request,
    });
  };

  private readonly handleMessage = (event: BrowserWebSocketEventPort): void => {
    if (this.closed || this.failure !== undefined) return;
    if (typeof event.data !== "string") {
      this.fail(protocolError(), true);
      return;
    }
    let message: Record<string, unknown>;
    try {
      message = requireRecord(JSON.parse(event.data));
    } catch {
      this.fail(protocolError(), true);
      return;
    }
    if (
      message.protocolVersion !== API_PROTOCOL_VERSION ||
      message.subscriptionId !== this.id
    ) {
      this.fail(protocolError(), true);
      return;
    }
    if (message.kind === "opened") {
      if (this.opened) this.fail(protocolError(), true);
      else this.opened = true;
      return;
    }
    if (!this.opened) {
      this.fail(protocolError(), true);
      return;
    }
    if (message.kind === "event") {
      let frame: ApiEventFrame;
      try {
        frame = validateFrame(message.frame, this.id);
      } catch (error) {
        this.fail(normalizeProtocolFailure(error), true);
        return;
      }
      this.logger.debug("web_socket.event_received", {
        sequence: frame.event.sequence,
        direction: frame.event.direction,
        eventType: frame.event.eventType,
      });
      this.deliver(frame);
      return;
    }
    if (message.kind === "done") {
      this.complete();
      return;
    }
    if (message.kind === "error") {
      let error: ApiTransportError;
      try {
        error = validateServerError(message.error);
      } catch (failure) {
        this.fail(normalizeProtocolFailure(failure), true);
        return;
      }
      this.fail(error, true);
      return;
    }
    this.fail(protocolError(), true);
  };

  private readonly handleError = (): void => {
    this.fail(
      new ApiTransportDisconnectedError("WebSocket Event connection failed"),
      true,
    );
  };

  private readonly handleClose = (): void => {
    if (this.done || this.closed || this.failure !== undefined) {
      this.terminate();
      return;
    }
    this.fail(
      new ApiTransportDisconnectedError("WebSocket Event connection closed"),
      false,
    );
  };

  private deliver(frame: ApiEventFrame): void {
    const read = this.reads.shift();
    if (read !== undefined) {
      read.resolve({ done: false, value: frame });
      return;
    }
    if (this.frames.length >= this.maxQueuedFrames) {
      this.fail(
        new ApiTransportError(
          "WEB_SOCKET_BACKPRESSURE_OVERFLOW",
          true,
          "WebSocket Event queue exceeded its configured limit",
        ),
        true,
      );
      return;
    }
    this.frames.push(frame);
  }

  private complete(): void {
    this.done = true;
    for (const read of this.reads.splice(0)) {
      read.resolve({ done: true, value: undefined });
    }
    this.closeSocket(1000, "complete");
    this.terminate();
  }

  private fail(error: unknown, closeSocket: boolean): void {
    if (this.failure !== undefined || this.done || this.closed) return;
    this.failure = error;
    for (const read of this.reads.splice(0)) read.reject(error);
    if (closeSocket) this.closeSocket(1000, "failed");
    this.terminate();
  }

  private async closeOnce(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const read of this.reads.splice(0)) {
      read.resolve({ done: true, value: undefined });
    }
    if (this.socket.readyState === SOCKET_OPEN) {
      this.send({
        protocolVersion: API_PROTOCOL_VERSION,
        kind: "close",
        subscriptionId: this.id,
      });
    }
    if (
      this.socket.readyState === SOCKET_CONNECTING ||
      this.socket.readyState === SOCKET_OPEN
    ) {
      this.closeSocket(1000, "closed");
    }
    this.terminate();
  }

  private send(message: WebSocketClientMessage): void {
    try {
      this.socket.send(JSON.stringify(message));
    } catch {
      this.fail(
        new ApiTransportDisconnectedError("WebSocket Event send failed"),
        true,
      );
    }
  }

  private closeSocket(code: number, reason: string): void {
    try {
      this.socket.close(code, reason);
    } catch {
      this.logger.debug("web_socket.close_failed");
    }
  }

  private terminate(): void {
    if (this.terminated) return;
    this.terminated = true;
    this.removeAbortListener?.();
    this.socket.removeEventListener("open", this.handleOpen);
    this.socket.removeEventListener("message", this.handleMessage);
    this.socket.removeEventListener("error", this.handleError);
    this.socket.removeEventListener("close", this.handleClose);
    this.onTerminated();
  }
}

function createNativeSocket(url: string, protocol: string): BrowserWebSocketPort {
  if (typeof globalThis.WebSocket !== "function") {
    throw new ApiTransportError(
      "WEB_SOCKET_UNAVAILABLE",
      false,
      "Browser WebSocket API is unavailable",
    );
  }
  return new globalThis.WebSocket(url, protocol) as unknown as BrowserWebSocketPort;
}

function createSubscriptionEndpoint(origin: string | URL): string {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw invalidOrigin();
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0 ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw invalidOrigin();
  }
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = WEB_API_SUBSCRIPTION_PATH;
  return url.toString();
}

function validateRequest(value: ApiRequest): ApiRequest {
  if (
    value.protocolVersion !== API_PROTOCOL_VERSION ||
    typeof value.requestId !== "string" ||
    value.requestId.trim().length === 0 ||
    typeof value.operation !== "string" ||
    value.operation.trim().length === 0
  ) {
    throw protocolError();
  }
  return cloneJson<ApiRequest>(value, "WebSocket subscription request");
}

function validateFrame(value: unknown, subscriptionId: string): ApiEventFrame {
  const frame = requireRecord(value);
  const event = requireRecord(frame.event);
  if (
    frame.protocolVersion !== API_PROTOCOL_VERSION ||
    frame.subscriptionId !== subscriptionId ||
    !Number.isSafeInteger(event.sequence) ||
    (event.sequence as number) < 1 ||
    (event.direction !== "input" && event.direction !== "output") ||
    typeof event.eventType !== "string" ||
    event.eventType.trim().length === 0
  ) {
    throw protocolError();
  }
  return cloneJson<ApiEventFrame>(frame, "WebSocket Event frame");
}

function validateServerError(value: unknown): ApiTransportError {
  const error = requireRecord(value);
  if (
    typeof error.code !== "string" ||
    !/^[A-Z][A-Z0-9_]{0,63}$/.test(error.code) ||
    typeof error.retryable !== "boolean"
  ) {
    throw protocolError();
  }
  return new ApiTransportError(
    error.code,
    error.retryable,
    `WebSocket Event server failed (${error.code})`,
  );
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw protocolError();
  }
  return value as Record<string, unknown>;
}

function cloneJson<TValue>(value: unknown, label: string): TValue {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new TypeError("undefined JSON");
    return JSON.parse(serialized) as TValue;
  } catch {
    throw new ApiTransportError(
      "WEB_SOCKET_PROTOCOL_ERROR",
      false,
      `${label} is not JSON serializable`,
    );
  }
}

function validateMaxQueuedFrames(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 4_096) {
    throw new ApiTransportError(
      "WEB_SOCKET_QUEUE_LIMIT_INVALID",
      false,
      "WebSocket Event queue limit is invalid",
    );
  }
  return value;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw abortReason(signal);
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("WebSocket subscription was aborted", "AbortError");
}

function protocolError(): ApiTransportError {
  return new ApiTransportError(
    "WEB_SOCKET_PROTOCOL_ERROR",
    false,
    "WebSocket Event protocol is invalid",
  );
}

function normalizeProtocolFailure(error: unknown): ApiTransportError {
  return error instanceof ApiTransportError ? error : protocolError();
}

function invalidOrigin(): ApiTransportError {
  return new ApiTransportError(
    "WEB_SOCKET_ORIGIN_INVALID",
    false,
    "WebSocket Event origin is invalid",
  );
}
