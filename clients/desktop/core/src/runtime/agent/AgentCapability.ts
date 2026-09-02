import type { PromptSection } from "../prompt/PromptSection.js";
import type { ToolDef } from "../tool/ToolDef.js";
import type { ContextCompactPolicy } from "../compact/ContextCompactPolicy.js";
import type { ContextNudgePolicy } from "../nudge/ContextNudgePolicy.js";

/** Agent 能力：按 agentType 从注册表加载 */
export interface AgentCapability {
  /** 系统提示词分段（内部区分静态/动态；静态不重复渲染，动态每次 provider call 重新生成） */
  systemSections: PromptSection[];
  /** 可用工具定义（scheme + handler + prompt 细节） */
  toolDefs: ToolDef[];
  /** 压缩策略（agent 定义自带；经 CompactPolicyChain 管理，toProviderCall 触发） */
  compactPolicies: ContextCompactPolicy[];
  /** 提示注入策略（agent 定义自带；数组遍历，toProviderCall 触发） */
  nudgePolicies: ContextNudgePolicy[];
}
