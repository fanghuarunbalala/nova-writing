/** Standard versioned composition for all currently canonical Core messages. */
import { noopLogger, type Logger } from "../../../observability/index.js";
import { coreRuntimeMessageSchemaRegistry } from "../CoreRuntimeMessageSchemaRegistry.js";
import type { RuntimeMessageSchemaRegistry } from "../RuntimeMessageSchemaRegistry.js";
import { CompositeRuntimeMessageProjector } from "./CompositeRuntimeMessageProjector.js";
import { CoreAssistantRuntimeMessageProjector } from "./CoreAssistantRuntimeMessageProjector.js";
import { CoreReminderRuntimeMessageProjector } from "./CoreReminderRuntimeMessageProjector.js";
import { CoreRuntimeMessageProjector } from "./CoreRuntimeMessageProjector.js";

export interface CoreConversationRuntimeMessageProjectorOptions {
  messageSchemaRegistry?: RuntimeMessageSchemaRegistry;
  logger?: Logger;
}

export class CoreConversationRuntimeMessageProjector extends CompositeRuntimeMessageProjector {
  constructor(options: CoreConversationRuntimeMessageProjectorOptions = {}) {
    super({
      id: "core.conversation-message",
      // 内部 assistant 投影行为变更（含工具轮次文本），版本递增以触发重建。
      version: "2",
      projectors: [
        new CoreRuntimeMessageProjector(),
        new CoreAssistantRuntimeMessageProjector(),
        new CoreReminderRuntimeMessageProjector(),
      ],
      messageSchemaRegistry:
        options.messageSchemaRegistry ?? coreRuntimeMessageSchemaRegistry,
      logger: options.logger ?? noopLogger,
    });
  }
}
