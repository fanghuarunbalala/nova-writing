import type { AgentToolPolicy } from "../tool/toolPolicy.js";

/**
 * Agent 定义（标识 + 展示 + 关联）：main agent id="main"（需持久化），subagent 不指定。
 * label/description 对齐旧版必填语义（展示 + Agent 工具描述渲染来源）；tools 为工具策略
 * （allow/deny 名单，不引入旧版 groupIds——新线无工具分组机制，见 architecture.md 偏离清单）。
 */
export interface AgentDefinition {
  /** Agent 类型 */
  agentType: string;
  /** Agent 版本 */
  agentVersion: string;
  /** Agent 实例 id：main="main"；subagent 缺省（不持久化） */
  agentId?: string;
  /** 展示名（非空白；Agent 工具描述渲染 `agentType（label）：description`） */
  label: string;
  /** 描述（非空白；Agent 工具描述渲染来源） */
  description: string;
  /** 工具策略（allow/deny 按工具名过滤；缺省 = 全池不过滤） */
  tools?: AgentToolPolicy;
  /** 关联的提示分段 id（Registry 注册的 PromptSection id；缺省空） */
  promptIds?: string[];
  /** 关联的 nudge 策略 id（Registry 注册；缺省空） */
  nudgeIds?: string[];
  /** 关联的 compact 策略 id（Registry 注册；缺省空） */
  compactIds?: string[];
}
