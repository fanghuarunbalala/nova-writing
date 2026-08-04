/** Unifies Conversation and Novel operations behind one Workspace ApiTransport. */
import type {
  ApiRequest,
  ApiRequestOptions,
  ApiResponse,
  ApiSubscription,
  ApiSubscriptionOptions,
  ApiTransport,
} from "../../transport/index.js";
import { isNovelQueryApiOperation } from "./NovelQueryApiRouter.js";

export interface WorkspaceApiRouterOptions {
  readonly conversations: ApiTransport;
  readonly novel: ApiTransport;
}

export class WorkspaceApiRouter implements ApiTransport {
  constructor(private readonly options: WorkspaceApiRouterOptions) {}

  request<TData = unknown>(
    request: ApiRequest,
    options?: ApiRequestOptions,
  ): Promise<ApiResponse<TData>> {
    return this.resolve(request.operation).request<TData>(request, options);
  }

  subscribe(
    request: ApiRequest,
    options?: ApiSubscriptionOptions,
  ): ApiSubscription {
    return this.resolve(request.operation).subscribe(request, options);
  }

  private resolve(operation: string): ApiTransport {
    return isNovelQueryApiOperation(operation)
      ? this.options.novel
      : this.options.conversations;
  }
}
