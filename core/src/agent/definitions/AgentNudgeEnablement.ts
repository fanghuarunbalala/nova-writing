/**
 * 一个 agent 显式启用的 nudge 列表（nudgeId）。
 * 装配侧以 `enablements[agentType].enabled` ∩ 工具组守卫过滤生效集。
 */
export interface AgentNudgeEnablement {
  readonly enabled: readonly string[];
}

export const EMPTY_AGENT_NUDGE_ENABLEMENT: AgentNudgeEnablement =
  Object.freeze({
    enabled: Object.freeze([]),
  });
