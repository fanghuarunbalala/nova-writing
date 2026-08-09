/** Routes control-lane inputs to the matching control handler by event type. */
import { INPUT_EVENT_TYPE } from "../../../event/index.js";
import type { PersistedInputEventSnapshot } from "../../../storage/journal/PersistedConversationEventSnapshot.js";
import type { RuntimeInputPumpHandler } from "../input/RuntimeInputPump.js";

export interface RuntimeControlInputDispatcherOptions {
  readonly stopHandler: RuntimeInputPumpHandler;
  readonly approvalDecisionHandler: RuntimeInputPumpHandler;
  /** 可选:conversation.mode.set 处理(装配方注入 mode service 的 handler)。 */
  /** Optional: conversation.mode.set handler (wired with the mode-service handler by the assembler). */
  readonly modeSetHandler?: RuntimeInputPumpHandler;
}

export class RuntimeControlInputDispatcher implements RuntimeInputPumpHandler {
  private readonly stopHandler: RuntimeInputPumpHandler;
  private readonly approvalDecisionHandler: RuntimeInputPumpHandler;
  private readonly modeSetHandler?: RuntimeInputPumpHandler;

  constructor(options: RuntimeControlInputDispatcherOptions) {
    this.stopHandler = options.stopHandler;
    this.approvalDecisionHandler = options.approvalDecisionHandler;
    this.modeSetHandler = options.modeSetHandler;
  }

  handle(input: PersistedInputEventSnapshot): Promise<void> {
    if (input.eventType === INPUT_EVENT_TYPE.approvalDecision) {
      return this.approvalDecisionHandler.handle(input);
    }
    if (input.eventType === INPUT_EVENT_TYPE.conversationModeSet) {
      if (this.modeSetHandler === undefined) {
        return this.stopHandler.handle(input);
      }
      return this.modeSetHandler.handle(input);
    }
    return this.stopHandler.handle(input);
  }
}
