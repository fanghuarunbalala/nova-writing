/** ExitComposeMode 工具：提交审批；批准后执行落库收口（状态到 applied）。 */
/** ExitComposeMode tool: submits for approval; after approval it settles (state to applied). */
import { noopLogger, type Logger } from "../../../observability/index.js";
import { ToolError } from "../../../runtime/tools/execution/index.js";
import {
  ToolPromptDetails,
  defineTool,
  type RegisteredTool,
  type ToolResult,
} from "../../../tooling/protocol/index.js";
import { ComposeStateError } from "../../../runtime/compose/index.js";
import {
  ExitComposeModeParametersSchema,
  type ExitComposeModeArguments,
} from "./schemas.js";
import {
  ComposeToolService,
  type ComposeExitDetails,
} from "./ToolService.js";

export interface CreateExitComposeModeToolOptions {
  readonly service: ComposeToolService;
  readonly logger?: Logger;
}

/** 构造 ExitComposeMode 工具。Builds the ExitComposeMode tool. */
export function createExitComposeModeTool(
  options: CreateExitComposeModeToolOptions,
): RegisteredTool<
  typeof ExitComposeModeParametersSchema,
  ComposeExitDetails
> {
  const logger = (options.logger ?? noopLogger).child({
    component: "exit_compose_mode_tool",
  });
  return defineTool({
    descriptor: {
      name: "ExitComposeMode",
      version: "1.0.0",
      label: "Exit Compose Mode",
      description:
        "Submits the current design draft for approval. After approval the design is marked applied and the session returns to its prior permission behavior.",
      parameters: ExitComposeModeParametersSchema,
      promptDetails: new ToolPromptDetails({
        usage:
          "Call ExitComposeMode only after the design draft is complete and ready for the author's approval.",
        parameterGuidance: "No parameters are required.",
        safetyGuidance:
          "Requires author approval; rejection returns to composing for revision.",
      }),
    },
    handler: {
      async execute(context, _arguments_) {
        context.signal.throwIfAborted();
        try {
          const details = await options.service.exit(context.conversationId);
          logger.info("exit_compose_mode.completed", {
            conversationId: context.conversationId,
            runId: context.runId,
            toolCallId: context.toolCallId,
            phase: details.phase,
          });
          return Object.freeze({
            content: Object.freeze([
              Object.freeze({
                type: "text" as const,
                text: "Design draft approved and applied.",
              }),
            ]),
            details,
          });
        } catch (error) {
          if (error instanceof ToolError) throw error;
          if (error instanceof ComposeStateError) {
            throw new ToolError({
              code: error.code,
              category: "execution",
              retryable: false,
              sideEffectStatus: "none",
              conversationId: context.conversationId,
              runId: context.runId,
              toolCallId: context.toolCallId,
              toolName: "ExitComposeMode",
              toolVersion: "1.0.0",
            });
          }
          throw new ToolError({
            code: "NOVEL_COMPOSE_EXIT_FAILED",
            category: "execution",
            retryable: true,
            sideEffectStatus: "none",
            conversationId: context.conversationId,
            runId: context.runId,
            toolCallId: context.toolCallId,
            toolName: "ExitComposeMode",
            toolVersion: "1.0.0",
          });
        }
      },
    },
  });
}
