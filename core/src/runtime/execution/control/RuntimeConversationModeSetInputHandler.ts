/**
 * Handles control-lane conversation.mode.set inputs by delegating to the shared
 * mode service and recording the control input outcome.
 *
 * A failed mode switch must not take down the control pump: errors are logged
 * and the input is consumed, never rethrown.
 */
import {
  captureDurableInputEventReference,
  INPUT_EVENT_TYPE,
} from "../../../event/index.js";
import { noopLogger, type Logger } from "../../../observability/index.js";
import type { PersistedInputEventSnapshot } from "../../../storage/journal/PersistedConversationEventSnapshot.js";
import type { ComposeToolService } from "../../../tools/novel/index.js";
import {
  isConversationMode,
  type ConversationMode,
} from "../../compose/index.js";
import type { RuntimeInputPumpHandler } from "../input/RuntimeInputPump.js";
import type {
  RecordRuntimeInputOutcomeOptions,
  RuntimeInputOutcomeCommit,
} from "./RuntimeInputOutcomeController.js";

export interface RuntimeConversationModeSetInputHandlerOptions {
  readonly conversationId: string;
  /** 统一 mode 服务(与 Enter/ExitComposeMode 工具共享同一实例)。 */
  /** Unified mode service (same instance as the Enter/ExitComposeMode tools). */
  readonly modeService: ComposeToolService;
  readonly outcomeRecorder: {
    record(
      options: RecordRuntimeInputOutcomeOptions,
    ): Promise<RuntimeInputOutcomeCommit>;
  };
  readonly logger?: Logger;
}

export class RuntimeConversationModeSetInputHandler
  implements RuntimeInputPumpHandler
{
  readonly #conversationId: string;
  readonly #modeService: ComposeToolService;
  readonly #outcomeRecorder: RuntimeConversationModeSetInputHandlerOptions["outcomeRecorder"];
  readonly #logger: Logger;

  constructor(options: RuntimeConversationModeSetInputHandlerOptions) {
    this.#conversationId = options.conversationId;
    this.#modeService = options.modeService;
    this.#outcomeRecorder = options.outcomeRecorder;
    this.#logger = (options.logger ?? noopLogger).child({
      component: "runtime_conversation_mode_set_input_handler",
      conversationId: this.#conversationId,
    });
  }

  async handle(input: PersistedInputEventSnapshot): Promise<void> {
    if (input.eventType !== INPUT_EVENT_TYPE.conversationModeSet) {
      // 防御性路由:非本事件的输入直接消耗,不抛错以免拖垮 control pump。
      await this.#consume(input);
      return;
    }
    let mode: ConversationMode | undefined;
    try {
      mode = readMode(input.payload);
      await this.#modeService.setMode(this.#conversationId, mode);
      this.#logger.info("runtime.mode_set.applied", {
        inputEventId: input.id,
        mode,
      });
    } catch (error) {
      this.#logger.warn("runtime.mode_set.failed", {
        inputEventId: input.id,
        ...(mode === undefined ? {} : { mode }),
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    } finally {
      await this.#consume(input);
    }
  }

  async #consume(input: PersistedInputEventSnapshot): Promise<void> {
    await this.#outcomeRecorder.record({
      inputEvent: captureDurableInputEventReference(input),
      outcome: "consumed",
    });
  }
}

function readMode(payload: unknown): ConversationMode {
  if (typeof payload !== "object" || payload === null) {
    throw new TypeError("Conversation mode-set payload is invalid");
  }
  const mode = (payload as Readonly<Record<string, unknown>>).mode;
  if (!isConversationMode(mode)) {
    throw new TypeError("Conversation mode is invalid");
  }
  return mode;
}
