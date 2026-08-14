/**
 * novel.compose 工具组（EnterComposeMode / ExitComposeMode）——对齐 legacy
 * tools/novel/compose/{Enter,Exit}.ts 语义：进入幂等（建 design 文件）、退出硬审批门
 * （requireApproval=true，bypass 不豁免——Exit 不在 canonical 写名单）。
 */
import type { ToolDef } from "../ToolDef.js";
import type { ToolCall } from "../../provider/types.js";
import {
  ComposeModeService,
  ComposeStateError,
  designFileWorkspaceRelativePath,
  renderComposeModeFullText,
  renderComposeModeExitText,
} from "../../../conversation/compose/index.js";

/** 解析 tool args JSON（失败抛中文错误，对齐 files.ts 惯例） */
function parseArgs(call: ToolCall): Record<string, unknown> {
  try {
    return JSON.parse(call.args) as Record<string, unknown>;
  } catch {
    throw new Error(`无效的 JSON 参数: ${call.args}`);
  }
}

/** EnterComposeMode 工具：进入 compose（建 design 文件 + 状态迁移，幂等） */
function enterComposeModeTool(service: ComposeModeService, conversationId: string): ToolDef {
  return {
    name: "EnterComposeMode",
    version: "1.0.0",
    description:
      "进入设计模式（compose）：创建会话 design 草稿文件，正式稿转为只读（canonical 写入被拒绝），草稿写入 `.novel/design/<conversationId>.md`。完成后用 ExitComposeMode 提交审批。\n\n用法：\n- purpose 可选（≤512 字符），仅记录在结果里。\n- 幂等：已处于设计模式时返回当前草稿路径，不重复进入。\n- 返回 workspace 相对路径；绝对路径会被文件工具拒绝。",
    parameters: {
      type: "object",
      properties: { purpose: { type: "string", maxLength: 512 } },
      additionalProperties: false,
    },
    promptDetail: {
      policy:
        "Call EnterComposeMode before drafting content; then use Read/Glob/Write/Edit on the returned design file using its workspace-relative path.",
      guidance:
        "purpose is optional and only recorded in the result. While compose is active, canonical novel writes are denied; file tools work across the workspace sandbox with workspace-relative paths.",
    },
    handler: {
      execute: async (call) => {
        const args = parseArgs(call);
        const purpose = typeof args.purpose === "string" && args.purpose.length > 0 ? args.purpose : undefined;
        if (purpose !== undefined && purpose.length > 512) {
          throw new Error("purpose 超长（≤512 字符）");
        }
        try {
          const details = await service.begin(conversationId, purpose);
          const rel = designFileWorkspaceRelativePath(details.designFilePath);
          const headline = details.alreadyActive
            ? `Compose mode is already active. Design file: ${rel}`
            : `Compose mode entered. Design file: ${rel}`;
          return [headline, "", renderComposeModeFullText(rel)].join("\n");
        } catch (error) {
          if (error instanceof ComposeStateError) {
            throw new Error(`NOVEL_COMPOSE_STATE_INVALID: ${error.message}`);
          }
          throw new Error(
            `NOVEL_COMPOSE_ENTER_FAILED: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      },
    },
  };
}

/** ExitComposeMode 工具：提交审批；批准后落库收口（状态到 applied + 归档草稿） */
function exitComposeModeTool(service: ComposeModeService, conversationId: string): ToolDef {
  return {
    name: "ExitComposeMode",
    version: "1.0.0",
    // 硬审批门：bypass 不豁免（不在 canonical 写名单，恒走 requireApproval 征询）
    requireApproval: true,
    description:
      "提交当前设计草稿审批并退出设计模式。审批通过后草稿归档（archive/）且会话恢复进入前的模式（canonical 写入恢复）；被驳回时回到设计阶段按意见修订后重新提交。\n\n用法：\n- 无参数；仅在草稿完成、可交付作者审批时调用。\n- 不得用文本询问审批，必须调用本工具。",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    promptDetail: {
      policy: "Call ExitComposeMode only after the design draft is complete and ready for the author's approval.",
      guidance: "No parameters are required. Requires author approval; rejection returns to composing for revision.",
    },
    handler: {
      execute: async () => {
        try {
          const details = await service.exit(conversationId);
          void details;
          return ["Compose mode exited. Design draft approved and applied.", "", renderComposeModeExitText()].join(
            "\n",
          );
        } catch (error) {
          if (error instanceof ComposeStateError) {
            throw new Error(`NOVEL_COMPOSE_STATE_INVALID: ${error.message}`);
          }
          throw new Error(
            `NOVEL_COMPOSE_EXIT_FAILED: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      },
    },
  };
}

/**
 * 创建 novel.compose 工具组（EnterComposeMode / ExitComposeMode）
 * @param service ComposeModeService（与 Conversation/权限门共享状态）
 * @param conversationId 会话 id（服务状态键；工厂时闭包注入，对齐 TodoWrite 惯例）
 * @returns 两个工具定义
 */
export function createComposeTools(service: ComposeModeService, conversationId: string): ToolDef[] {
  return [enterComposeModeTool(service, conversationId), exitComposeModeTool(service, conversationId)];
}
