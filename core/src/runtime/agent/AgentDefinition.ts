/** Agent 定义（标识 + 关联）：main agent id="main"（需持久化），subagent 不指定 */
export interface AgentDefinition {
  /** Agent 类型 */
  agentType: string;
  /** Agent 版本 */
  agentVersion: string;
  /** Agent 实例 id：main="main"；subagent 缺省（不持久化） */
  agentId?: string;
  /** 关联的工具名（Registry 注册的 ToolDef.name；缺省空） */
  toolNames?: string[];
  /** 关联的提示分段 id（Registry 注册的 PromptSection id；缺省空） */
  promptIds?: string[];
  /** 关联的 nudge 策略 id（Registry 注册；缺省空） */
  nudgeIds?: string[];
  /** 关联的 compact 策略 id（Registry 注册；缺省空） */
  compactIds?: string[];
}
