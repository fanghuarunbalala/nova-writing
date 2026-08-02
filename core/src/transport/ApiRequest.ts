/** Serializable client-to-Host request envelope shared by every frontend Transport. */
export const API_PROTOCOL_VERSION = 1 as const;

export interface ApiRequest<
  TOperation extends string = string,
  TPayload = unknown,
> {
  readonly protocolVersion: typeof API_PROTOCOL_VERSION;
  readonly requestId: string;
  readonly operation: TOperation;
  readonly payload: TPayload;
}

export interface ApiRequestOptions {
  readonly signal?: AbortSignal;
}

export interface ApiSubscriptionOptions extends ApiRequestOptions {}
