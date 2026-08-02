/** Provider-neutral Transport failures used by controllers and concrete adapters. */
export class ApiTransportError extends Error {
  constructor(
    public readonly code: string,
    public readonly retryable: boolean,
    message: string,
  ) {
    super(message);
    this.name = "ApiTransportError";
  }
}

export class ApiTransportDisconnectedError extends ApiTransportError {
  constructor(message = "API Transport is disconnected") {
    super("API_TRANSPORT_DISCONNECTED", true, message);
    this.name = "ApiTransportDisconnectedError";
  }
}

export function isApiTransportDisconnectedError(
  error: unknown,
): error is ApiTransportDisconnectedError {
  return (
    error instanceof ApiTransportDisconnectedError ||
    (error !== null &&
      typeof error === "object" &&
      (error as { code?: unknown }).code === "API_TRANSPORT_DISCONNECTED")
  );
}
