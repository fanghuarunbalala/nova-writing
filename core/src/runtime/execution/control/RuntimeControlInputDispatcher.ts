/** Routes control-lane inputs to the matching control handler by event type. */
import { INPUT_EVENT_TYPE } from "../../../event/index.js";
import type { PersistedInputEventSnapshot } from "../../../storage/journal/PersistedConversationEventSnapshot.js";
import type { RuntimeInputPumpHandler } from "../input/RuntimeInputPump.js";

export interface RuntimeControlInputDispatcherOptions {
  readonly stopHandler: RuntimeInputPumpHandler;
  readonly approvalDecisionHandler: RuntimeInputPumpHandler;
}

export class RuntimeControlInputDispatcher implements RuntimeInputPumpHandler {
  private readonly stopHandler: RuntimeInputPumpHandler;
  private readonly approvalDecisionHandler: RuntimeInputPumpHandler;

  constructor(options: RuntimeControlInputDispatcherOptions) {
    this.stopHandler = options.stopHandler;
    this.approvalDecisionHandler = options.approvalDecisionHandler;
  }

  handle(input: PersistedInputEventSnapshot): Promise<void> {
    if (input.eventType === INPUT_EVENT_TYPE.approvalDecision) {
      return this.approvalDecisionHandler.handle(input);
    }
    return this.stopHandler.handle(input);
  }
}
