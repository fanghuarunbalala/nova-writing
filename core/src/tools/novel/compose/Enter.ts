/** EnterComposeMode 工具：进入 compose（建 design 文件 + 状态迁移）。 */
/** EnterComposeMode tool: enters compose (creates the design file and transitions state). */
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
  designFileWorkspaceRelativePath,
  renderComposeModeFullText,
} from "../../../runtime/nudge/definitions/compose.js";
import {
  EnterComposeModeParametersSchema,
  type EnterComposeModeArguments,
} from "./schemas.js";
import {
  ComposeToolService,
  type ComposeEnterDetails,
} from "./ToolService.js";

export interface CreateEnterComposeModeToolOptions {
  readonly service: ComposeToolService;
  readonly logger?: Logger;
}

/** 构造 EnterComposeMode 工具。Builds the EnterComposeMode tool. */
export function createEnterComposeModeTool(
  options: CreateEnterComposeModeToolOptions,
): RegisteredTool<
  typeof EnterComposeModeParametersSchema,
  ComposeEnterDetails
> {
  const logger = (options.logger ?? noopLogger).child({
    component: "enter_compose_mode_tool",
  });
  return defineTool({
    descriptor: {
      name: "EnterComposeMode",
      version: "1.0.0",
      label: "Enter Compose Mode",
      description:
        "Enters compose mode: creates the conversation design file and switches the session to read-only canon plus that file. Use ExitComposeMode to submit the design for approval.",
      parameters: EnterComposeModeParametersSchema,
      promptDetails: new ToolPromptDetails({
        usage:
          "Call EnterComposeMode before drafting content; then use Read/Edit/Write on the returned design file using its workspace-relative path.",
        parameterGuidance:
          "purpose is optional and only recorded in the result.",
        safetyGuidance:
          "While compose is active, canonical novel writes are denied; file tools (Read/Glob/Write/Edit) work across the workspace sandbox with workspace-relative paths.",
      }),
    },
    handler: {
      async execute(context, arguments_) {
        context.signal.throwIfAborted();
        try {
          const details = await options.service.begin(
            context.conversationId,
            arguments_.purpose,
          );
          logger.info("enter_compose_mode.completed", {
            conversationId: context.conversationId,
            runId: context.runId,
            toolCallId: context.toolCallId,
            designFilePath: details.designFilePath,
          });
          // 结果只给 workspace 相对路径（绝对路径会被 FileToolService 拒绝）。
          // Only the workspace-relative path is shown (absolute paths are rejected).
          const designFilePathRelative = designFileWorkspaceRelativePath(
            details.designFilePath,
          );
          return Object.freeze({
            content: Object.freeze([
              Object.freeze({
                type: "text" as const,
                text: [
                  `Compose mode entered. Design file: ${designFilePathRelative}`,
                  "",
                  renderComposeModeFullText(designFilePathRelative),
                ].join("\n"),
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
              toolName: "EnterComposeMode",
              toolVersion: "1.0.0",
            });
          }
          throw new ToolError({
            code: "NOVEL_COMPOSE_ENTER_FAILED",
            category: "execution",
            retryable: true,
            sideEffectStatus: "none",
            conversationId: context.conversationId,
            runId: context.runId,
            toolCallId: context.toolCallId,
            toolName: "EnterComposeMode",
            toolVersion: "1.0.0",
          });
        }
      },
    },
  });
}
