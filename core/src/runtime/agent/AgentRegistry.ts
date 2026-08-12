import type { AgentCapability } from "./AgentCapability.js";

/** Agent 定义注册表：按 agentType / agentVersion 加载 agent 能力 */
export interface AgentDefinitionRegistry {
  /**
   * 获取 agent 能力
   * @param agentType Agent 类型
   * @param agentVersion Agent 版本
   * @returns agent 能力（system 分段 + 工具定义）
   */
  get(agentType: string, agentVersion?: string): AgentCapability;
}
