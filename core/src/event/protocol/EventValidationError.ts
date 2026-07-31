export interface EventValidationIssue {
  path: string;
  message: string;
}

export class EventValidationError extends Error {
  constructor(
    message: string,
    public readonly issues: EventValidationIssue[] = [],
  ) {
    super(message);
    this.name = "EventValidationError";
  }
}
