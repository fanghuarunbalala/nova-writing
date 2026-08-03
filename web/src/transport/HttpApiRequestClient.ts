/** Browser HTTP request half of the future HTTP/WebSocket ApiTransport. */
import {
  API_PROTOCOL_VERSION,
  ApiTransportDisconnectedError,
  ApiTransportError,
  noopLogger,
  type ApiRequest,
  type ApiRequestOptions,
  type ApiResponse,
  type Logger,
} from "@novel/core";

export const WEB_API_REQUEST_PATH = "/api/v1/requests" as const;
export const DEFAULT_WEB_API_RESPONSE_BYTES = 1_048_576;

export interface WebRequestHeadersProvider {
  getHeaders():
    | Readonly<Record<string, string>>
    | Promise<Readonly<Record<string, string>>>;
}

export interface HttpApiRequestClientOptions {
  readonly origin: string | URL;
  readonly fetch?: typeof fetch;
  readonly headersProvider?: WebRequestHeadersProvider;
  readonly maxResponseBytes?: number;
  readonly logger?: Logger;
}

export class HttpApiRequestClient {
  readonly endpoint: string;

  private readonly fetch: typeof fetch;
  private readonly headersProvider?: WebRequestHeadersProvider;
  private readonly maxResponseBytes: number;
  private readonly logger: Logger;

  constructor(options: HttpApiRequestClientOptions) {
    this.endpoint = createRequestEndpoint(options.origin);
    this.fetch = options.fetch ?? globalThis.fetch?.bind(globalThis);
    if (typeof this.fetch !== "function") {
      throw new ApiTransportError(
        "WEB_FETCH_UNAVAILABLE",
        false,
        "Browser Fetch API is unavailable",
      );
    }
    this.headersProvider = options.headersProvider;
    this.maxResponseBytes = validateMaxResponseBytes(
      options.maxResponseBytes ?? DEFAULT_WEB_API_RESPONSE_BYTES,
    );
    this.logger = (options.logger ?? noopLogger).child({
      component: "http_api_request_client",
    });
  }

  async request<TData = unknown>(
    request: ApiRequest,
    options?: ApiRequestOptions,
  ): Promise<ApiResponse<TData>> {
    throwIfAborted(options?.signal);
    const captured = validateRequest(request);
    const headers = await this.resolveHeaders();
    throwIfAborted(options?.signal);
    this.logger.debug("web_http.request_started", {
      requestId: captured.requestId,
      operation: captured.operation,
    });
    let response: Response;
    try {
      response = await this.fetch(this.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(captured),
        credentials: "include",
        cache: "no-store",
        redirect: "error",
        referrerPolicy: "no-referrer",
        ...(options?.signal !== undefined ? { signal: options.signal } : {}),
      });
    } catch {
      throwIfAborted(options?.signal);
      throw new ApiTransportDisconnectedError("Web HTTP API is unavailable");
    }
    if (!response.ok) {
      const retryable = isRetryableStatus(response.status);
      this.logger.warn("web_http.request_failed", {
        requestId: captured.requestId,
        operation: captured.operation,
        status: response.status,
        retryable,
      });
      throw new ApiTransportError(
        "WEB_HTTP_STATUS_ERROR",
        retryable,
        "Web HTTP API returned an unsuccessful status",
      );
    }
    const contentType = response.headers.get("content-type")?.toLowerCase();
    if (contentType?.includes("application/json") !== true) {
      throw new ApiTransportError(
        "WEB_HTTP_PROTOCOL_ERROR",
        false,
        "Web HTTP API response content type is invalid",
      );
    }
    const body = await readBoundedBody(response, this.maxResponseBytes);
    let value: unknown;
    try {
      value = JSON.parse(body);
    } catch {
      throw new ApiTransportError(
        "WEB_HTTP_PROTOCOL_ERROR",
        false,
        "Web HTTP API response is invalid JSON",
      );
    }
    const result = cloneJson<ApiResponse<TData>>(value, "Web HTTP API response");
    this.logger.debug("web_http.request_completed", {
      requestId: captured.requestId,
      operation: captured.operation,
      status: response.status,
      responseBytes: new TextEncoder().encode(body).byteLength,
    });
    return result;
  }

  private async resolveHeaders(): Promise<Headers> {
    const headers = new Headers({
      accept: "application/json",
      "content-type": "application/json",
    });
    if (this.headersProvider === undefined) return headers;
    let provided: Readonly<Record<string, string>>;
    try {
      provided = await this.headersProvider.getHeaders();
    } catch {
      throw new ApiTransportError(
        "WEB_REQUEST_HEADERS_FAILED",
        true,
        "Web request headers are unavailable",
      );
    }
    if (provided === null || typeof provided !== "object" || Array.isArray(provided)) {
      throw invalidHeader();
    }
    const entries = Object.entries(provided);
    if (entries.length > 32) throw invalidHeader();
    for (const [name, value] of entries) {
      const normalizedName = name.trim().toLowerCase();
      if (
        normalizedName.length === 0 ||
        normalizedName === "accept" ||
        normalizedName === "content-type" ||
        name.length > 128 ||
        value.length > 8_192 ||
        /[\r\n]/.test(name) ||
        /[\r\n]/.test(value)
      ) {
        throw invalidHeader();
      }
      try {
        headers.set(name, value);
      } catch {
        throw invalidHeader();
      }
    }
    return headers;
  }
}

function createRequestEndpoint(origin: string | URL): string {
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
  return new URL(WEB_API_REQUEST_PATH, url).toString();
}

function validateRequest(value: ApiRequest): ApiRequest {
  if (
    value.protocolVersion !== API_PROTOCOL_VERSION ||
    typeof value.requestId !== "string" ||
    value.requestId.trim().length === 0 ||
    typeof value.operation !== "string" ||
    value.operation.trim().length === 0
  ) {
    throw new ApiTransportError(
      "WEB_HTTP_PROTOCOL_ERROR",
      false,
      "Web HTTP API request is invalid",
    );
  }
  return cloneJson<ApiRequest>(value, "Web HTTP API request");
}

async function readBoundedBody(
  response: Response,
  maxResponseBytes: number,
): Promise<string> {
  let body: string;
  try {
    body = await response.text();
  } catch {
    throw new ApiTransportDisconnectedError("Web HTTP API response was interrupted");
  }
  if (new TextEncoder().encode(body).byteLength > maxResponseBytes) {
    throw new ApiTransportError(
      "WEB_HTTP_RESPONSE_TOO_LARGE",
      false,
      "Web HTTP API response exceeds the configured limit",
    );
  }
  return body;
}

function validateMaxResponseBytes(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 16_777_216) {
    throw new ApiTransportError(
      "WEB_HTTP_RESPONSE_LIMIT_INVALID",
      false,
      "Web HTTP response limit is invalid",
    );
  }
  return value;
}

function cloneJson<TValue>(value: unknown, label: string): TValue {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new TypeError("undefined JSON");
    return JSON.parse(serialized) as TValue;
  } catch {
    throw new ApiTransportError(
      "WEB_HTTP_PROTOCOL_ERROR",
      false,
      `${label} is not JSON serializable`,
    );
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted !== true) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException("Web HTTP request was aborted", "AbortError");
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function invalidOrigin(): ApiTransportError {
  return new ApiTransportError(
    "WEB_HTTP_ORIGIN_INVALID",
    false,
    "Web HTTP API origin is invalid",
  );
}

function invalidHeader(): ApiTransportError {
  return new ApiTransportError(
    "WEB_HTTP_HEADER_INVALID",
    false,
    "Web HTTP request header is invalid",
  );
}
