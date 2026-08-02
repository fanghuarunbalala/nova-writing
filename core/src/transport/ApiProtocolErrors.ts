/** Stable client-side failures for malformed or explicitly rejected API frames. */
import type {
  ApiErrorCategory,
  ApiErrorSnapshot,
} from "./ApiErrorSnapshot.js";

export class ApiProtocolError extends Error {
  readonly code = "API_PROTOCOL_ERROR";

  constructor(message: string) {
    super(message);
    this.name = "ApiProtocolError";
  }
}

export class ApiRemoteError extends Error {
  readonly code: string;
  readonly category: ApiErrorCategory;
  readonly retryable: boolean;

  constructor(snapshot: ApiErrorSnapshot) {
    super(snapshot.message);
    this.name = "ApiRemoteError";
    this.code = snapshot.code;
    this.category = snapshot.category;
    this.retryable = snapshot.retryable;
  }
}
