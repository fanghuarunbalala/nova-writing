export interface RuntimeMessageValidationIssue {
  path: string;
  message: string;
}

export class RuntimeMessageValidationError extends Error {
  constructor(
    message: string,
    public readonly issues: RuntimeMessageValidationIssue[] = [],
  ) {
    super(message);
    this.name = "RuntimeMessageValidationError";
  }
}
