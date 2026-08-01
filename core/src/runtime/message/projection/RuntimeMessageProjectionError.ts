export class RuntimeMessageProjectionError extends Error {
  constructor(
    message: string,
    public readonly projectorId: string,
    public readonly eventId: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "RuntimeMessageProjectionError";
  }
}
