/** Renderer-only ApiTransport over the narrow Electron Preload capability bridge. */
import {
  ApiTransportDisconnectedError,
  ApiTransportError,
  noopLogger,
  type ApiEventFrame,
  type ApiRequest,
  type ApiRequestOptions,
  type ApiResponse,
  type ApiSubscription,
  type ApiSubscriptionOptions,
  type ApiTransport,
  type Logger,
} from "@novel/core";
import type {
  ElectronBridgeAcknowledgement,
  ElectronBridgeResult,
  ElectronBridgeSubscriptionRead,
  ElectronPreloadBridge,
} from "../../shared/index.js";

export interface ElectronApiTransportOptions {
  readonly bridge: ElectronPreloadBridge;
  readonly logger?: Logger;
}

export class ElectronApiTransport implements ApiTransport {
  private readonly bridge: ElectronPreloadBridge;
  private readonly logger: Logger;
  private readonly subscriptions = new Set<ElectronApiSubscription>();
  private closed = false;
  private closePromise?: Promise<void>;

  constructor(options: ElectronApiTransportOptions) {
    this.bridge = options.bridge;
    this.logger = (options.logger ?? noopLogger).child({
      component: "electron_api_transport",
    });
  }

  async request<TData = unknown>(
    request: ApiRequest,
    options?: ApiRequestOptions,
  ): Promise<ApiResponse<TData>> {
    this.assertOpen();
    throwIfAborted(options?.signal);
    const captured = cloneJson<ApiRequest>(request, "Electron API request");
    this.logger.debug("electron_transport.request_started", {
      requestId: captured.requestId,
      operation: captured.operation,
    });
    const result = await waitWithAbort(
      this.invokeBridge(() => this.bridge.request(captured)),
      options?.signal,
      () => this.cancelRequest(captured.requestId),
    );
    this.assertOpen();
    const response = unwrapBridgeResult<ApiResponse<TData>>(result);
    this.logger.debug("electron_transport.request_completed", {
      requestId: captured.requestId,
      operation: captured.operation,
      ok: response.ok,
    });
    return cloneJson<ApiResponse<TData>>(response, "Electron API response");
  }

  subscribe(
    request: ApiRequest,
    options?: ApiSubscriptionOptions,
  ): ApiSubscription {
    this.assertOpen();
    throwIfAborted(options?.signal);
    const captured = cloneJson<ApiRequest>(request, "Electron subscription request");
    const subscriptionId = `electron:${captured.requestId}`;
    if ([...this.subscriptions].some((subscription) => subscription.id === subscriptionId)) {
      throw new ApiTransportError(
        "ELECTRON_SUBSCRIPTION_DUPLICATE",
        false,
        "Electron API subscription identity is already active",
      );
    }
    let subscription: ElectronApiSubscription;
    subscription = new ElectronApiSubscription({
      id: subscriptionId,
      request: captured,
      bridge: this.bridge,
      signal: options?.signal,
      logger: this.logger,
      invokeBridge: (operation) => this.invokeBridge(operation),
      onTerminated: () => this.subscriptions.delete(subscription),
    });
    this.subscriptions.add(subscription);
    this.logger.info("electron_transport.subscription_opened", {
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
    const failures = results.filter((result) => result.status === "rejected");
    this.logger.info("electron_transport.close_completed", {
      subscriptionCount: subscriptions.length,
      failureCount: failures.length,
    });
    if (failures.length > 0) {
      throw new ApiTransportError(
        "ELECTRON_TRANSPORT_CLOSE_FAILED",
        true,
        "Electron API Transport failed to close cleanly",
      );
    }
  }

  private async cancelRequest(requestId: string): Promise<void> {
    try {
      const result = await this.invokeBridge(() => this.bridge.cancelRequest(requestId));
      unwrapBridgeResult<ElectronBridgeAcknowledgement>(result);
    } catch {
      this.logger.debug("electron_transport.request_cancel_failed", { requestId });
    }
  }

  private async invokeBridge<TValue>(
    operation: () => Promise<ElectronBridgeResult<TValue>>,
  ): Promise<ElectronBridgeResult<TValue>> {
    try {
      return await operation();
    } catch {
      throw new ApiTransportDisconnectedError("Electron API bridge is unavailable");
    }
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new ApiTransportDisconnectedError("Electron API Transport is closed");
    }
  }
}

interface ElectronApiSubscriptionOptions {
  readonly id: string;
  readonly request: ApiRequest;
  readonly bridge: ElectronPreloadBridge;
  readonly signal?: AbortSignal;
  readonly logger: Logger;
  readonly invokeBridge: <TValue>(
    operation: () => Promise<ElectronBridgeResult<TValue>>,
  ) => Promise<ElectronBridgeResult<TValue>>;
  readonly onTerminated: () => void;
}

class ElectronApiSubscription implements ApiSubscription {
  readonly id: string;

  private readonly bridge: ElectronPreloadBridge;
  private readonly signal?: AbortSignal;
  private readonly logger: Logger;
  private readonly invokeBridge: ElectronApiSubscriptionOptions["invokeBridge"];
  private readonly onTerminated: () => void;
  private readonly removeAbortListener?: () => void;
  private readonly openPromise: Promise<void>;
  private opened = false;
  private closed = false;
  private terminated = false;
  private closePromise?: Promise<void>;

  constructor(options: ElectronApiSubscriptionOptions) {
    this.id = options.id;
    this.bridge = options.bridge;
    this.signal = options.signal;
    this.logger = options.logger.child({ subscriptionId: this.id });
    this.invokeBridge = options.invokeBridge;
    this.onTerminated = options.onTerminated;
    this.openPromise = this.open(options.request);
    if (this.signal !== undefined) {
      const abort = (): void => {
        void this.close();
      };
      this.signal.addEventListener("abort", abort, { once: true });
      this.removeAbortListener = () => this.signal?.removeEventListener("abort", abort);
    }
  }

  async next(): Promise<IteratorResult<ApiEventFrame>> {
    try {
      throwIfAborted(this.signal);
      if (this.closed) return { done: true, value: undefined };
      await this.openPromise;
      throwIfAborted(this.signal);
      if (this.closed) return { done: true, value: undefined };
      const result = await this.invokeBridge(() =>
        this.bridge.readSubscription(this.id),
      );
      const read = unwrapBridgeResult<ElectronBridgeSubscriptionRead>(result);
      if (read.done) {
        this.closed = true;
        this.terminate();
        return { done: true, value: undefined };
      }
      const frame = cloneJson<ApiEventFrame>(
        read.frame,
        "Electron subscription frame",
      );
      this.logger.debug("electron_transport.event_received", {
        sequence: frame.event.sequence,
        direction: frame.event.direction,
        eventType: frame.event.eventType,
      });
      return { done: false, value: frame };
    } catch (error) {
      await Promise.allSettled([this.close()]);
      throw error;
    }
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

  private async open(request: ApiRequest): Promise<void> {
    const result = await this.invokeBridge(() =>
      this.bridge.openSubscription({
        subscriptionId: this.id,
        request,
      }),
    );
    unwrapBridgeResult<ElectronBridgeAcknowledgement>(result);
    this.opened = true;
  }

  private async closeOnce(): Promise<void> {
    this.closed = true;
    try {
      await this.openPromise.catch(() => undefined);
      if (!this.opened) return;
      const result = await this.invokeBridge(() => this.bridge.closeSubscription(this.id));
      unwrapBridgeResult<ElectronBridgeAcknowledgement>(result);
    } finally {
      this.terminate();
    }
  }

  private terminate(): void {
    if (this.terminated) return;
    this.terminated = true;
    this.removeAbortListener?.();
    this.onTerminated();
  }
}

function unwrapBridgeResult<TValue>(value: unknown): TValue {
  const result = requireRecord(value, "Electron bridge result");
  if (result.ok === true && "value" in result) {
    return result.value as TValue;
  }
  if (result.ok === false) {
    const error = requireRecord(result.error, "Electron bridge error");
    const code = requireNonBlank(error.code, "Electron bridge error code");
    const retryable = requireBoolean(
      error.retryable,
      "Electron bridge error retryable",
    );
    if (code === "API_TRANSPORT_DISCONNECTED") {
      throw new ApiTransportDisconnectedError("Electron API bridge disconnected");
    }
    throw new ApiTransportError(
      code,
      retryable,
      `Electron API bridge failed (${code})`,
    );
  }
  throw new ApiTransportError(
    "ELECTRON_BRIDGE_PROTOCOL_ERROR",
    false,
    "Electron API bridge returned an invalid result",
  );
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiTransportError(
      "ELECTRON_BRIDGE_PROTOCOL_ERROR",
      false,
      `${label} is invalid`,
    );
  }
  return value as Record<string, unknown>;
}

function requireNonBlank(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ApiTransportError(
      "ELECTRON_BRIDGE_PROTOCOL_ERROR",
      false,
      `${label} is invalid`,
    );
  }
  return value;
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new ApiTransportError(
      "ELECTRON_BRIDGE_PROTOCOL_ERROR",
      false,
      `${label} is invalid`,
    );
  }
  return value;
}

function cloneJson<TValue>(value: unknown, label: string): TValue {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
      throw new TypeError("JSON serialization returned undefined");
    }
    return JSON.parse(serialized) as TValue;
  } catch {
    throw new ApiTransportError(
      "ELECTRON_BRIDGE_PROTOCOL_ERROR",
      false,
      `${label} is not JSON serializable`,
    );
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted !== true) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException("Electron API operation was aborted", "AbortError");
}

function waitWithAbort<TValue>(
  operation: Promise<TValue>,
  signal: AbortSignal | undefined,
  onAbort: () => void,
): Promise<TValue> {
  if (signal === undefined) return operation;
  throwIfAborted(signal);
  return new Promise<TValue>((resolve, reject) => {
    let settled = false;
    const abort = (): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      onAbort();
      reject(
        signal.reason instanceof Error
          ? signal.reason
          : new DOMException("Electron API operation was aborted", "AbortError"),
      );
    };
    signal.addEventListener("abort", abort, { once: true });
    operation.then(
      (value) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}
