/**
 * 生产 Novel 子代理目录：novel_explorer / novel_compose 的 SubagentDefinition、
 * 工具策略 id 与 Agent 工具组合策略。
 * Production Novel subagent catalog: SubagentDefinitions, tool policy ids, and
 * the Agent tool composition policy for novel_explorer / novel_compose.
 */
import { SubagentDefinitionCatalog } from "./SubagentDefinitionCatalog.js";
import type {
  SubagentDefinition,
  SubagentToolCompositionPolicy,
} from "./SubagentTaskProtocol.js";

/** novel agent 的工具策略 id（父代理）。Novel agent tool policy id. */
export const NOVEL_AGENT_TOOL_POLICY_ID = "toolPolicy:novel" as const;

/** novel_explorer 只读子代理的工具策略 id。Explorer tool policy id. */
export const NOVEL_EXPLORER_TOOL_POLICY_ID =
  "toolPolicy:novel_explorer" as const;

/** novel_compose 只读子代理的工具策略 id。Compose tool policy id. */
export const NOVEL_COMPOSE_TOOL_POLICY_ID =
  "toolPolicy:novel_compose" as const;

/** 子代理 Prompt/结果/引用的容量限制。Subagent payload capacity limits. */
const NOVEL_SUBAGENT_LIMITS = Object.freeze({
  maximumPromptBytes: 4096,
  maximumArtifactReferences: 4,
  maximumResultBytes: 4096,
} as const);

/** 生产 novel_explorer / novel_compose 子代理定义。Production subagent definitions. */
export const NOVEL_SUBAGENT_DEFINITIONS: readonly SubagentDefinition[] =
  Object.freeze([
    Object.freeze({
      agentType: "novel_explorer",
      definitionVersion: "1.0.0",
      label: "Novel Explorer",
      description:
        "Reads the outline, characters, locations, paragraphs, volumes, and chapters to return concise textual findings.",
      toolPolicyId: NOVEL_EXPLORER_TOOL_POLICY_ID,
    }),
    Object.freeze({
      agentType: "novel_compose",
      definitionVersion: "1.0.0",
      label: "Novel Compose",
      description:
        "Reads the current story state to draft outline and prose design proposals as text.",
      toolPolicyId: NOVEL_COMPOSE_TOOL_POLICY_ID,
    }),
  ]);

/** 生产 Agent 工具的组合策略：允许两种类型 + 容量限制。Production composition policy. */
export const NOVEL_SUBAGENT_TOOL_COMPOSITION_POLICY: SubagentToolCompositionPolicy =
  Object.freeze({
    allowedAgentTypes: Object.freeze([
      "novel_explorer",
      "novel_compose",
    ]),
    limits: NOVEL_SUBAGENT_LIMITS,
  });

/** 生产 novel 子代理定义目录。Production novel subagent definition catalog. */
export function createProductionSubagentDefinitionCatalog(): SubagentDefinitionCatalog {
  return new SubagentDefinitionCatalog(NOVEL_SUBAGENT_DEFINITIONS);
}
