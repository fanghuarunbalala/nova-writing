/**
 * novel_compose 薄 builder：声明式定义（definitions/NovelComposeAgentDefinition）
 * 经共享装配（NovelSubagent.ts）成 AgentLoop。配置单一事实源在 definitions/，
 * 本文件只保留具名入口（entrypoint builders map 引用）。
 */
import type { AgentLoop } from "../loop/AgentLoop.js";
import {
  novelComposeAgentDefinition,
  NOVEL_COMPOSE_TOOL_NAMES,
} from "./definitions/index.js";
import { buildNovelSubagent } from "./NovelSubagent.js";
import type { NovelSubagentOptions } from "./NovelSubagent.js";

/** novel_compose agent 类型 */
export const NOVEL_COMPOSE_AGENT_TYPE = novelComposeAgentDefinition.agentType;

export { NOVEL_COMPOSE_TOOL_NAMES };

/** 装配 novel_compose 子代理 loop（只读工具子集 + compose 四段 prompt） */
export function buildNovelComposeAgent(opts: NovelSubagentOptions): AgentLoop {
  return buildNovelSubagent({ ...opts, definition: novelComposeAgentDefinition });
}
