/** Standard versioned composition for all currently canonical Core messages. */
import { noopLogger, type Logger } from "../../../observability/index.js";
import { coreRuntimeMessageSchemaRegistry } from "../CoreRuntimeMessageSchemaRegistry.js";
import type { RuntimeMessageSchemaRegistry } from "../RuntimeMessageSchemaRegistry.js";
import { CompositeRuntimeMessageProjector } from "./CompositeRuntimeMessageProjector.js";
import { CoreAssistantRuntimeMessageProjector } from "./CoreAssistantRuntimeMessageProjector.js";
import { CoreRuntimeMessageProjector } from "./CoreRuntimeMessageProjector.js";

export interface CoreConversationRuntimeMessageProjectorOptions {
  messageSchemaRegistry?: RuntimeMessageSchemaRegistry;
  logger?: Logger;
}

export class CoreConversationRuntimeMessageProjector extends CompositeRuntimeMessageProjector {
  constructor(options: CoreConversationRuntimeMessageProjectorOptions = {}) {
    super({
      id: "core.conversation-message",
      version: "1",
      projectors: [
        new CoreRuntimeMessageProjector(),
        new CoreAssistantRuntimeMessageProjector(),
      ],
      messageSchemaRegistry:
        options.messageSchemaRegistry ?? coreRuntimeMessageSchemaRegistry,
      logger: options.logger ?? noopLogger,
    });
  }
}
