/**
 * novel_explorer 薄 builder：声明式定义（definitions/NovelExplorerAgentDefinition）
 * 经共享装配（NovelSubagent.ts）成 AgentLoop。配置单一事实源在 definitions/，
 * 本文件只保留具名入口（entrypoint builders map 引用）。
 */
import type { AgentLoop } from "../loop/AgentLoop.js";
import {
  novelExplorerAgentDefinition,
  NOVEL_EXPLORER_TOOL_NAMES,
} from "./definitions/index.js";
import { buildNovelSubagent } from "./NovelSubagent.js";
import type { NovelSubagentOptions } from "./NovelSubagent.js";

/** novel_explorer agent 类型 */
export const NOVEL_EXPLORER_AGENT_TYPE = novelExplorerAgentDefinition.agentType;

export { NOVEL_EXPLORER_TOOL_NAMES };

/** 装配 novel_explorer 子代理 loop（只读工具子集 + explorer 专属 prompt 分段） */
export function buildNovelExplorerAgent(opts: NovelSubagentOptions): AgentLoop {
  return buildNovelSubagent({ ...opts, definition: novelExplorerAgentDefinition });
}
