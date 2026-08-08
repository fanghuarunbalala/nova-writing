/**
 * 全局 nudge 启用索引：agentType → AgentNudgeEnablement。
 * 未登记的 agent 视作未启用任何 nudge（装配侧落空）。
 */
import {
  EMPTY_AGENT_NUDGE_ENABLEMENT,
  type AgentNudgeEnablement,
} from "./AgentNudgeEnablement.js";
import { novelAgentNudgeEnablement } from "./NovelAgentDefinition.js";

export const AGENT_NUDGE_ENABLEMENTS: Readonly<
  Record<string, AgentNudgeEnablement>
> = Object.freeze({
  novel: novelAgentNudgeEnablement,
});

export function resolveAgentNudgeEnablements(
  agentType: string,
): AgentNudgeEnablement {
  return AGENT_NUDGE_ENABLEMENTS[agentType] ?? EMPTY_AGENT_NUDGE_ENABLEMENT;
}
