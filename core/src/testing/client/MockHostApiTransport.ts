/** Shared Mock wire behavior; concrete classes model Electron and HTTP/WebSocket placement. */
import { noopLogger, type Logger } from "../../observability/index.js";
import type { PersistedConversationEventSnapshot } from "../../storage/index.js";
import {
  API_PROTOCOL_VERSION,
  type ApiEventFrame,
  type ApiRequest,
  type ApiRequestOptions,
  type ApiResponse,
  type ApiSubscription,
  type ApiSubscriptionOptions,
  type ApiTransport,
} from "../../transport/index.js";
import type { DeterministicMockNovelHost } from "./DeterministicMockNovelHost.js";
import {
  MockTransportDisconnectedError,
  MockTransportFaultController,
} from "./MockTransportFaultController.js";

export interface MockHostApiTransportOptions {
  readonly host: DeterministicMockNovelHost;
  readonly transportKind: string;
  readonly faultController?: MockTransportFaultController;
  readonly logger?: Logger;
}

export abstract class MockHostApiTransport implements ApiTransport {
  readonly faultController: MockTransportFaultController;

  private readonly host: DeterministicMockNovelHost;
  private readonly transportKind: string;
  private readonly logger: Logger;
  private readonly subscriptions = new Set<MockHostApiSubscription>();
  private closed = false;
  private closePromise?: Promise<void>;

  protected constructor(options: MockHostApiTransportOptions) {
    this.host = options.host;
    this.transportKind = options.transportKind;
    this.faultController =
      options.faultController ?? new MockTransportFaultController();
    this.logger = (options.logger ?? noopLogger).child({
      component: "mock_host_api_transport",
      transportKind: this.transportKind,
    });
  }

  async request<TData = unknown>(
    request: ApiRequest,
    options?: ApiRequestOptions,
  ): Promise<ApiResponse<TData>> {
    this.assertAvailable();
    throwIfAborted(options?.signal);
    const serializedRequest = jsonRoundTrip<ApiRequest>(request);
    this.logger.debug("mock_transport.request_started", {
      requestId: serializedRequest.requestId,
      operation: serializedRequest.operation,
    });
    const response = await this.host.request(serializedRequest);
    this.assertAvailable();
    throwIfAborted(options?.signal);
    this.logger.debug("mock_transport.request_completed", {
      requestId: serializedRequest.requestId,
      operation: serializedRequest.operation,
      ok: response.ok,
    });
    return jsonRoundTrip<ApiResponse<TData>>(response);
  }

  subscribe(
    request: ApiRequest,
    options?: ApiSubscriptionOptions,
  ): ApiSubscription {
    this.assertAvailable();
    throwIfAborted(options?.signal);
    const serializedRequest = jsonRoundTrip<ApiRequest>(request);
    const underlying = this.host.subscribe(serializedRequest, options);
    let subscription: MockHostApiSubscription;
    subscription = new MockHostApiSubscription({
      transportKind: this.transportKind,
      underlying,
      faultController: this.faultController,
      logger: this.logger,
      onTerminated: () => {
        this.subscriptions.delete(subscription);
      },
    });
    this.subscriptions.add(subscription);
    this.logger.info("mock_transport.subscription_opened", {
      requestId: serializedRequest.requestId,
      operation: serializedRequest.operation,
      subscriptionId: subscription.id,
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
    const errors = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    this.logger.info("mock_transport.close_completed", {
      subscriptionCount: subscriptions.length,
      errorCount: errors.length,
    });
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new AggregateError(errors, "Failed to close Mock API Transport");
    }
  }

  private assertAvailable(): void {
    if (this.closed) throw new MockTransportDisconnectedError(this.transportKind);
    this.faultController.assertConnected(this.transportKind);
  }
}

interface MockHostApiSubscriptionOptions {
  readonly transportKind: string;
  readonly underlying: {
    readonly id: string;
    next(): Promise<IteratorResult<PersistedConversationEventSnapshot>>;
    close(): Promise<void>;
  };
  readonly faultController: MockTransportFaultController;
  readonly logger: Logger;
  readonly onTerminated: () => void;
}

class MockHostApiSubscription implements ApiSubscription {
  readonly id: string;

  private readonly transportKind: string;
  private readonly underlying: MockHostApiSubscriptionOptions["underlying"];
  private readonly faultController: MockTransportFaultController;
  private readonly logger: Logger;
  private readonly onTerminated: () => void;
  private readonly removeDisconnectListener: () => void;
  private readonly pendingFrames: ApiEventFrame[] = [];
  private disconnected = false;
  private closed = false;
  private terminated = false;
  private closePromise?: Promise<void>;

  constructor(options: MockHostApiSubscriptionOptions) {
    this.transportKind = options.transportKind;
    this.id = `${options.transportKind}:${options.underlying.id}`;
    this.underlying = options.underlying;
    this.faultController = options.faultController;
    this.logger = options.logger.child({ subscriptionId: this.id });
    this.onTerminated = options.onTerminated;
    this.removeDisconnectListener = this.faultController.onDisconnect(() => {
      this.disconnected = true;
      void this.underlying.close().then(
        () => this.terminate(),
        () => this.terminate(),
      );
    });
  }

  async next(): Promise<IteratorResult<ApiEventFrame>> {
    if (this.disconnected) {
      throw new MockTransportDisconnectedError(this.transportKind);
    }
    if (this.closed) return { done: true, value: undefined };
    const pending = this.pendingFrames.shift();
    if (pending !== undefined) return { done: false, value: pending };

    this.faultController.assertConnected(this.transportKind);
    const result = await this.underlying.next();
    if (this.disconnected) {
      throw new MockTransportDisconnectedError(this.transportKind);
    }
    if (result.done) {
      this.terminate();
      return { done: true, value: undefined };
    }
    const frame = jsonRoundTrip<ApiEventFrame>({
      protocolVersion: API_PROTOCOL_VERSION,
      subscriptionId: this.id,
      event: result.value,
    });
    const duplicateCount = this.faultController.takeDuplicateDeliveryCount();
    for (let index = 0; index < duplicateCount; index += 1) {
      this.pendingFrames.push(jsonRoundTrip<ApiEventFrame>(frame));
    }
    this.logger.debug("mock_transport.event_delivered", {
      sequence: result.value.sequence,
      direction: result.value.direction,
      eventType: result.value.eventType,
      duplicateCount,
    });
    return { done: false, value: frame };
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

  private async closeOnce(): Promise<void> {
    this.closed = true;
    try {
      await this.underlying.close();
    } finally {
      this.terminate();
    }
  }

  private terminate(): void {
    if (this.terminated) return;
    this.terminated = true;
    this.removeDisconnectListener();
    this.onTerminated();
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException("API operation was aborted", "AbortError");
  }
}

function jsonRoundTrip<T>(value: unknown): T {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new TypeError("Mock Transport value is not JSON serializable");
  }
  return JSON.parse(serialized) as T;
}
