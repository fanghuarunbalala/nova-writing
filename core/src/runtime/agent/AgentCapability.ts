import type { PromptSection } from "../prompt/PromptSection.js";
import type { ToolScheme } from "../provider/types.js";

/** 工具定义（复用 provider 中立的 ToolScheme） */
export type ToolDef = ToolScheme;

/** Agent 能力：按 agentType 从注册表加载 */
export interface AgentCapability {
  /** 系统提示词分段（内部区分静态/动态；静态不重复渲染，动态每次 provider call 重新生成） */
  systemSections: PromptSection[];
  /** 可用工具定义 */
  toolDefs: ToolDef[];
}
