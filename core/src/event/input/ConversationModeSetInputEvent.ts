/** Command-priority InputEvent used by clients to switch the per-conversation mode. */
import type { InputEventOptions } from "./InputEventOptions.js";
import { INPUT_EVENT_TYPE } from "./InputEventType.js";
import { CommandInputEvent } from "./CommandInputEvent.js";
import {
  ConversationModeSetPayload,
  type ConversationModeSetPayloadOptions,
} from "./payload/ConversationModeSetPayload.js";

export type ConversationModeSetInputEventOptions = InputEventOptions &
  ConversationModeSetPayloadOptions;

export class ConversationModeSetInputEvent extends CommandInputEvent {
  constructor(options: ConversationModeSetInputEventOptions) {
    super("mode.set", new ConversationModeSetPayload(options), options);
  }

  override getEventType(): string {
    return INPUT_EVENT_TYPE.conversationModeSet;
  }
}
