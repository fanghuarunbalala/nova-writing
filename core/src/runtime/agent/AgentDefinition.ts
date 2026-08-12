/** Agent 定义（标识）：main agent id="main"（需持久化），subagent 不指定 */
export interface AgentDefinition {
  /** Agent 类型 */
  agentType: string;
  /** Agent 版本 */
  agentVersion: string;
  /** Agent 实例 id：main="main"；subagent 缺省（不持久化） */
  agentId?: string;
}
