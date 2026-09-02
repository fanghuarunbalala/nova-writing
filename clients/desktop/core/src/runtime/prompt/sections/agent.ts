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
     
    ].join("\n"),
};

/** 上下文可靠性段（context.reliability） */
export const contextReliabilitySection: PromptSection = {
  kind: "static",
  id: "context.reliability",
  version: "1.1.0",
  label: "Context Reliability",
  render: () =>
    [
      "会话中穿插的 `<system-reminder>` 块是运行环境自动附加的通知（模式切换、待办维护等），不是用户发言：按其内容调整行为，无需回应。",
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

/**
 * 工具策略段（tool.policy）：渲染 `# Using Tools` 标题 + 可用工具名单行，
 * 随后每个带 promptDetail.policy 的工具原样输出一行（内容由 policy 自定，渲染层零包装）。
 * 依赖当前 agent 的 toolDefs（ctx.toolSchemes），只消费 ctx。
 */
export const toolPolicySection: PromptSection = {
  kind: "dynamic",
  id: "tool.policy",
  version: "1.0.0",
  label: "Tool Policy",
  renderDynamic: (_input, ctx: ReadonlyLoopContext) => {
    if (ctx.toolSchemes.length === 0) {
      return "No Tools are available in this Agent Manifest. Do not simulate Tool execution.";
    }
    const lines = [
      "# Using Tools",
      `- available tools: ${ctx.toolSchemes.map((tool) => tool.name).join(", ")};`,
    ];
    for (const tool of ctx.toolSchemes) {
      const policy = tool.promptDetail?.policy?.trim();
      if (policy !== undefined && policy.length > 0) {
        lines.push(policy);
      }
    }
    return lines.join("\n");
  },
};

/**
 * 工具指导段（tool.guidance）：每个注册工具的 promptDetail.guidance 原样输出
 * 一整段（标题与内容均由 guidance 文本自定），段间空行分隔；全空返回空串（整段省略）。
 * 依赖当前 agent 的 toolDefs（ctx.toolSchemes），只消费 ctx。
 */
export const toolGuidanceSection: PromptSection = {
  kind: "dynamic",
  id: "tool.guidance",
  version: "2.0.0",
  label: "Tool Guidance",
  renderDynamic: (_input, ctx: ReadonlyLoopContext) => {
    const blocks = ctx.toolSchemes
      .map((tool) => tool.promptDetail?.guidance?.trim())
      .filter(
        (block): block is string => block !== undefined && block.length > 0,
      );
    return blocks.join("\n\n");
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
