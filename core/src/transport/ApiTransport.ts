/** Byte-delivery boundary; implementations carry frames without owning business routing. */
import type { ApiRequest, ApiRequestOptions, ApiSubscriptionOptions } from "./ApiRequest.js";
import type { ApiResponse } from "./ApiResponse.js";
import type { ApiSubscription } from "./ApiSubscription.js";

export interface ApiTransport {
  request<TData = unknown>(
    request: ApiRequest,
    options?: ApiRequestOptions,
  ): Promise<ApiResponse<TData>>;

  subscribe(
    request: ApiRequest,
    options?: ApiSubscriptionOptions,
  ): ApiSubscription;
}
