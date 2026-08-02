/** Deterministic JSON round-trip Transport for client and Proxy contract tests. */
import type {
  ApiRequest,
  ApiRequestOptions,
  ApiResponse,
  ApiSubscription,
  ApiSubscriptionOptions,
  ApiTransport,
  ApiEventFrame,
} from "../../transport/index.js";

export type ScriptedApiRequestHandler = (
  request: ApiRequest,
  options?: ApiRequestOptions,
) => ApiResponse | Promise<ApiResponse>;

export type ScriptedApiSubscriptionHandler = (
  request: ApiRequest,
  options?: ApiSubscriptionOptions,
) => ApiSubscription;

export interface ScriptedApiTransportOptions {
  readonly request: ScriptedApiRequestHandler;
  readonly subscribe: ScriptedApiSubscriptionHandler;
}

export class ScriptedApiTransport implements ApiTransport {
  readonly requests: ApiRequest[] = [];
  readonly subscriptionRequests: ApiRequest[] = [];
  readonly requestOptions: (ApiRequestOptions | undefined)[] = [];
  readonly subscriptionOptions: (ApiSubscriptionOptions | undefined)[] = [];

  private readonly requestHandler: ScriptedApiRequestHandler;
  private readonly subscriptionHandler: ScriptedApiSubscriptionHandler;

  constructor(options: ScriptedApiTransportOptions) {
    this.requestHandler = options.request;
    this.subscriptionHandler = options.subscribe;
  }

  async request<TData = unknown>(
    request: ApiRequest,
    options?: ApiRequestOptions,
  ): Promise<ApiResponse<TData>> {
    const serializedRequest = jsonRoundTrip<ApiRequest>(request);
    this.requests.push(serializedRequest);
    this.requestOptions.push(options);
    const response = await this.requestHandler(serializedRequest, options);
    return jsonRoundTrip<ApiResponse<TData>>(response);
  }

  subscribe(
    request: ApiRequest,
    options?: ApiSubscriptionOptions,
  ): ApiSubscription {
    const serializedRequest = jsonRoundTrip<ApiRequest>(request);
    this.subscriptionRequests.push(serializedRequest);
    this.subscriptionOptions.push(options);
    return this.subscriptionHandler(serializedRequest, options);
  }
}

export interface ScriptedApiSubscriptionOptions {
  readonly id: string;
  readonly frames?: readonly ApiEventFrame[];
  readonly closeFailure?: unknown;
}

export class ScriptedApiSubscription implements ApiSubscription {
  readonly id: string;
  closeCalls = 0;

  private readonly frames: ApiEventFrame[];
  private readonly closeFailure?: unknown;
  private closed = false;

  constructor(options: ScriptedApiSubscriptionOptions) {
    this.id = options.id;
    this.frames = [...(options.frames ?? [])];
    this.closeFailure = options.closeFailure;
  }

  async next(): Promise<IteratorResult<ApiEventFrame>> {
    if (this.closed || this.frames.length === 0) {
      return { done: true, value: undefined };
    }
    return {
      done: false,
      value: jsonRoundTrip<ApiEventFrame>(this.frames.shift()),
    };
  }

  async return(): Promise<IteratorResult<ApiEventFrame>> {
    await this.close();
    return { done: true, value: undefined };
  }

  [Symbol.asyncIterator](): this {
    return this;
  }

  async close(): Promise<void> {
    this.closeCalls += 1;
    this.closed = true;
    if (this.closeFailure !== undefined) throw this.closeFailure;
  }
}

function jsonRoundTrip<T>(value: unknown): T {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new TypeError("Scripted API value is not JSON serializable");
  }
  return JSON.parse(serialized) as T;
}
