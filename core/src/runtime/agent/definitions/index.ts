/**
 * runtime/agent 声明式定义统一出口（工具组在 runtime/tool/groups）。
 * subagent 目录（SubagentCatalogEntry[]）从 AgentDefinition 派生——
 * label/description/tools.allow 单一事实源在定义，展示层不再手写双份。
 */
import type { AgentDefinition } from "../AgentDefinition.js";
import type { SubagentCatalogEntry } from "../../tool/definitions/subagent.js";
import { novelExplorerAgentDefinition } from "./NovelExplorerAgentDefinition.js";
import { novelComposeAgentDefinition } from "./NovelComposeAgentDefinition.js";
// BookAnalyst / ProjectImporter 独立后台 Agent（不进 NOVEL_SUBAGENT_DEFINITIONS——非 subagent）

/** AgentDefinition → 目录条目（agentType/label/description + tools.allow） */
function subagentCatalogEntryOf(definition: AgentDefinition): SubagentCatalogEntry {
  return {
    agentType: definition.agentType,
    label: definition.label,
    description: definition.description,
    ...(definition.tools.allow === undefined
      ? {}
      : { tools: { allow: definition.tools.allow } }),
  };
}

/** 可派生子代理定义目录（Agent 工具描述渲染来源：explorer + compose） */
export const NOVEL_SUBAGENT_DEFINITIONS: readonly SubagentCatalogEntry[] = Object.freeze([
  subagentCatalogEntryOf(novelExplorerAgentDefinition),
  subagentCatalogEntryOf(novelComposeAgentDefinition),
]);

export * from "./NovelAgentDefinition.js";
export * from "./BookAnalystAgentDefinition.js";
export * from "./ProjectImporterAgentDefinition.js";
export * from "./NovelExplorerAgentDefinition.js";
export * from "./NovelComposeAgentDefinition.js";
export * from "./novelSections.js";
