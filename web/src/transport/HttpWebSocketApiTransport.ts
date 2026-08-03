/** Complete browser ApiTransport composed from HTTP requests and WebSocket Events. */
import {
  ApiTransportDisconnectedError,
  ApiTransportError,
  noopLogger,
  type ApiRequest,
  type ApiRequestOptions,
  type ApiResponse,
  type ApiSubscription,
  type ApiSubscriptionOptions,
  type ApiTransport,
  type Logger,
} from "@novel/core";
import {
  HttpApiRequestClient,
  type WebRequestHeadersProvider,
} from "./HttpApiRequestClient.js";
import {
  WebSocketEventClient,
  type BrowserWebSocketFactory,
} from "./WebSocketEventClient.js";

export interface HttpWebSocketApiTransportOptions {
  readonly origin: string | URL;
  readonly fetch?: typeof fetch;
  readonly headersProvider?: WebRequestHeadersProvider;
  readonly maxResponseBytes?: number;
  readonly createSocket?: BrowserWebSocketFactory;
  readonly maxQueuedFrames?: number;
  readonly logger?: Logger;
}

export class HttpWebSocketApiTransport implements ApiTransport {
  private readonly requests: HttpApiRequestClient;
  private readonly events: WebSocketEventClient;
  private readonly logger: Logger;
  private readonly requestControllers = new Set<AbortController>();
  private readonly activeRequests = new Set<Promise<unknown>>();
  private closed = false;
  private closePromise?: Promise<void>;

  constructor(options: HttpWebSocketApiTransportOptions) {
    this.logger = (options.logger ?? noopLogger).child({
      component: "http_websocket_api_transport",
    });
    this.requests = new HttpApiRequestClient({
      origin: options.origin,
      ...(options.fetch !== undefined ? { fetch: options.fetch } : {}),
      ...(options.headersProvider !== undefined
        ? { headersProvider: options.headersProvider }
        : {}),
      ...(options.maxResponseBytes !== undefined
        ? { maxResponseBytes: options.maxResponseBytes }
        : {}),
      logger: this.logger,
    });
    this.events = new WebSocketEventClient({
      origin: options.origin,
      ...(options.createSocket !== undefined
        ? { createSocket: options.createSocket }
        : {}),
      ...(options.maxQueuedFrames !== undefined
        ? { maxQueuedFrames: options.maxQueuedFrames }
        : {}),
      logger: this.logger,
    });
  }

  async request<TData = unknown>(
    request: ApiRequest,
    options?: ApiRequestOptions,
  ): Promise<ApiResponse<TData>> {
    this.assertOpen();
    const controller = new AbortController();
    const combined = combineAbortSignals(options?.signal, controller.signal);
    this.requestControllers.add(controller);
    const operation = this.requests.request<TData>(request, {
      signal: combined.signal,
    });
    this.activeRequests.add(operation);
    void operation.then(
      () => this.finishRequest(controller, operation, combined.cleanup),
      () => this.finishRequest(controller, operation, combined.cleanup),
    );
    return operation;
  }

  subscribe(
    request: ApiRequest,
    options?: ApiSubscriptionOptions,
  ): ApiSubscription {
    this.assertOpen();
    return this.events.subscribe(request, options);
  }

  close(): Promise<void> {
    this.closePromise ??= this.closeOnce();
    return this.closePromise;
  }

  private async closeOnce(): Promise<void> {
    this.closed = true;
    const controllers = [...this.requestControllers];
    for (const controller of controllers) {
      controller.abort(
        new DOMException("Web API Transport was closed", "AbortError"),
      );
    }
    const requests = [...this.activeRequests];
    const [, eventResult] = await Promise.all([
      Promise.allSettled(requests),
      this.events.close().then(
        () => ({ status: "fulfilled" as const }),
        () => ({ status: "rejected" as const }),
      ),
    ]);
    this.logger.info("web_transport.close_completed", {
      requestCount: requests.length,
      subscriptionFailure: eventResult.status === "rejected",
    });
    if (eventResult.status === "rejected") {
      throw new ApiTransportError(
        "WEB_TRANSPORT_CLOSE_FAILED",
        true,
        "Web API Transport failed to close cleanly",
      );
    }
  }

  private finishRequest(
    controller: AbortController,
    operation: Promise<unknown>,
    cleanup: () => void,
  ): void {
    cleanup();
    this.requestControllers.delete(controller);
    this.activeRequests.delete(operation);
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new ApiTransportDisconnectedError("Web API Transport is closed");
    }
  }
}

interface CombinedAbortSignal {
  readonly signal: AbortSignal;
  readonly cleanup: () => void;
}

function combineAbortSignals(
  caller: AbortSignal | undefined,
  lifecycle: AbortSignal,
): CombinedAbortSignal {
  if (caller === undefined) {
    return { signal: lifecycle, cleanup: () => undefined };
  }
  const controller = new AbortController();
  const abortFromCaller = (): void => controller.abort(abortReason(caller));
  const abortFromLifecycle = (): void => controller.abort(abortReason(lifecycle));
  caller.addEventListener("abort", abortFromCaller, { once: true });
  lifecycle.addEventListener("abort", abortFromLifecycle, { once: true });
  if (caller.aborted) abortFromCaller();
  else if (lifecycle.aborted) abortFromLifecycle();
  return {
    signal: controller.signal,
    cleanup: () => {
      caller.removeEventListener("abort", abortFromCaller);
      lifecycle.removeEventListener("abort", abortFromLifecycle);
    },
  };
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("Web API operation was aborted", "AbortError");
}
