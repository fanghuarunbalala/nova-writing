/** Command InputEvent used by clients to resolve one pending Tool approval. */
import type { InputEventOptions } from "./InputEventOptions.js";
import { INPUT_EVENT_TYPE } from "./InputEventType.js";
import { CommandInputEvent } from "./CommandInputEvent.js";
import {
  ApprovalDecisionPayload,
  type ApprovalDecisionPayloadOptions,
} from "./payload/ApprovalDecisionPayload.js";

export type ApprovalDecisionInputEventOptions = InputEventOptions &
  ApprovalDecisionPayloadOptions;

export class ApprovalDecisionInputEvent extends CommandInputEvent {
  constructor(options: ApprovalDecisionInputEventOptions) {
    super("tool.approval.decision", new ApprovalDecisionPayload(options), options);
  }

  override getEventType(): string {
    return INPUT_EVENT_TYPE.approvalDecision;
  }
}
