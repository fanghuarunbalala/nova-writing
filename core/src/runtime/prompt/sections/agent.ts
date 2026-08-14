import type {
  PromptSection,
  DynamicPromptSectionInput,
} from "../PromptSection.js";
import type { ReadonlyLoopContext } from "../../loop/LoopContext.js";

/**
 * Agent 通用 prompt 分节（从旧 main 分支完整迁移）。
 * 对应旧 `prompt/sections/agent/`：CoreRuntimeProtocol / CompletionContract /
 * ContextReliability / ConversationBehavior / TodoGuidance / ToolGuidance。
 */

/** 运行时协议段（core.runtime.protocol） */
export const coreRuntimeProtocolSection: PromptSection = {
  kind: "static",
  id: "core.runtime.protocol",
  version: "1.0.0",
  label: "Core Runtime Protocol",
  render: () =>
    [
      "Operate through the provided Conversation input, event, context, and Tool protocols.",
      "Do not claim that an external action or persisted change occurred unless the Runtime or a Tool confirms it.",
      "Treat cancellation, approval, and Tool failures as authoritative Runtime state.",
    ].join("\n"),
};

/** 完成契约段（completion.contract） */
export const completionContractSection: PromptSection = {
  kind: "static",
  id: "completion.contract",
  version: "1.0.0",
  label: "Completion Contract",
  render: () =>
    [
      "Complete the current objective before declaring success.",
      "Distinguish completed work from proposals, pending approval, and unavailable capabilities.",
      "Conclude with the result and any concrete next action the user must take.",
    ].join("\n"),
};

/** 上下文可靠性段（context.reliability） */
export const contextReliabilitySection: PromptSection = {
  kind: "static",
  id: "context.reliability",
  version: "1.0.0",
  label: "Context Reliability",
  render: () =>
    [
      "Treat current Runtime state and Tool results as more authoritative than remembered earlier text.",
      "Do not invent missing persisted state, Tool results, configuration, or user decisions.",
      "When context is incomplete, state the uncertainty and obtain the missing information through available capabilities.",
    ].join("\n"),
};

/** 对话行为段（conversation.behavior） */
export const conversationBehaviorSection: PromptSection = {
  kind: "static",
  id: "conversation.behavior",
  version: "1.0.0",
  label: "Conversation Behavior",
  render: () =>
    [
      "Collaborate with the user, preserve their intent, and make reasonable progress without unnecessary questions.",
      "Present important alternatives clearly when the user's creative judgment is required.",
      "Keep responses focused on the current Conversation objective.",
    ].join("\n"),
};

/** Todo 指导段（todo.guidance） */
export const todoGuidanceSection: PromptSection = {
  kind: "static",
  id: "todo.guidance",
  version: "1.0.0",
  label: "Todo Guidance",
  render: () =>
    [
      "Use TodoWrite for non-trivial multi-step work, not for simple questions.",
      "Keep stable Todo IDs, at most one in-progress item, and update status as work advances.",
      "A Todo list is Runtime execution state, not domain data or Conversation history.",
    ].join("\n"),
};

/** 工具指导段（tool.guidance）：动态列出可用工具（只消费 ctx，忽略动态输入） */
export const toolGuidanceSection: PromptSection = {
  kind: "dynamic",
  id: "tool.guidance",
  version: "1.0.0",
  label: "Tool Guidance",
  renderDynamic: (_input, ctx: ReadonlyLoopContext) => {
    if (ctx.toolSchemes.length === 0) {
      return "No Tools are available in this Agent Manifest. Do not simulate Tool execution.";
    }
    return [
      "Available Tools:",
      ...ctx.toolSchemes.map(
        (tool) => `- ${tool.name}${tool.description ? `: ${tool.description.split("\n")[0]}` : ""}`,
      ),
      "Use only the listed Tools and follow each Tool schema exactly.",
    ].join("\n");
  },
};

/** 时区解析（ECMAScript 标准能力；失败回退 UTC） */
function resolveTimezone(): string {
  try {
    const timezone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof timezone === "string" && timezone.length > 0
      ? timezone
      : "UTC";
  } catch {
    return "UTC";
  }
}

/** 本地日期 YYYY-MM-DD（渲染时现场计算） */
function resolveLocalDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * core.environment 动态段：每调用渲染环境信息块。
 * 日期/时区在渲染时现场计算；workdir/platform/modelId 来自动态段输入
 * （workdir/platform 由 node 层注入，modelId 由 LoopContext 以 run.sampling.model
 * 补齐）。workdir 或 platform 为空时整段省略（返回空串，不进 prompt）。
 */
export const coreEnvironmentSection: PromptSection = {
  kind: "dynamic",
  id: "core.environment",
  version: "1.0.0",
  label: "Core Environment",
  renderDynamic: (input: DynamicPromptSectionInput) => {
    const environment = input.environment;
    if (
      environment === undefined ||
      environment.workdir.trim().length === 0 ||
      environment.platform.trim().length === 0
    ) {
      return "";
    }
    return [
      "# 环境信息",
      `- 当前日期：${resolveLocalDate()}（${resolveTimezone()}）`,
      `- 平台：${environment.platform}`,
      `- 工作目录：${environment.workdir}`,
      ...(environment.modelId === undefined
        ? []
        : [`- 模型：${environment.modelId}`]),
    ].join("\n");
  },
};
