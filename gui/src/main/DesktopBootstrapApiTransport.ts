/** Returns stable unavailable responses until a desktop Workspace Host is active. */
import {
  API_ERROR_CATEGORY,
  API_PROTOCOL_VERSION,
  ApiTransportError,
  type ApiRequest,
  type ApiRequestOptions,
  type ApiResponse,
  type ApiSubscription,
  type ApiSubscriptionOptions,
  type ApiTransport,
} from "@novel/core";

export class DesktopBootstrapApiTransport implements ApiTransport {
  request<TData = unknown>(
    request: ApiRequest,
    _options: ApiRequestOptions = {},
  ): Promise<ApiResponse<TData>> {
    return Promise.resolve(
      Object.freeze({
        protocolVersion: API_PROTOCOL_VERSION,
        requestId: request.requestId,
        ok: false,
        error: Object.freeze({
          code: "DESKTOP_WORKSPACE_NOT_OPEN",
          category: API_ERROR_CATEGORY.unavailable,
          retryable: true,
          message: "Open a Workspace before using Conversation APIs",
        }),
      }) as ApiResponse<TData>,
    );
  }

  subscribe(
    _request: ApiRequest,
    _options: ApiSubscriptionOptions = {},
  ): ApiSubscription {
    throw new ApiTransportError(
      "DESKTOP_WORKSPACE_NOT_OPEN",
      true,
      "Open a Workspace before subscribing to Conversation events",
    );
  }
}
