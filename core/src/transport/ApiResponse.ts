/** Serializable success-or-error response correlated to exactly one API request. */
import type { ApiErrorSnapshot } from "./ApiErrorSnapshot.js";
import type { API_PROTOCOL_VERSION } from "./ApiRequest.js";

export type ApiResponse<TData = unknown> =
  | {
      readonly protocolVersion: typeof API_PROTOCOL_VERSION;
      readonly requestId: string;
      readonly ok: true;
      readonly data: TData;
    }
  | {
      readonly protocolVersion: typeof API_PROTOCOL_VERSION;
      readonly requestId: string;
      readonly ok: false;
      readonly error: ApiErrorSnapshot;
    };
