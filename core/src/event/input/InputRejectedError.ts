export type InputRejectionCode =
  | "invalid_event"
  | "unknown_event_type"
  | "conversation_id_required"
  | "conversation_id_mismatch"
  | "event_id_conflict"
  | "conversation_not_found"
  | "conversation_not_accepting_input";

export class InputRejectedError extends Error {
  constructor(
    public readonly code: InputRejectionCode,
    message: string,
  ) {
    super(message);
    this.name = "InputRejectedError";
  }
}
