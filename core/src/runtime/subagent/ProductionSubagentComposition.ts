/**
 * 生产 Novel 子代理目录：novel_explorer / novel_compose 的 SubagentDefinition、
 * 工具策略 id 与 Agent 工具组合策略。
 * Production Novel subagent catalog: SubagentDefinitions, tool policy ids, and
 * the Agent tool composition policy for novel_explorer / novel_compose.
 */
import { SubagentDefinitionCatalog } from "./SubagentDefinitionCatalog.js";
import { SUBAGENT_SUMMARY_MAX_BYTES } from "./SubagentProtocolValidator.js";
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

/** 子代理 Prompt/结果/引用的容量限制。Subagent payload capacity limits.
 * 结果上限与 SubagentProtocolValidator.SUBAGENT_SUMMARY_MAX_BYTES 一致（compose 提案
 * 常超旧 4KB）；prompt 上限保持 4096：超长 prompt 在 Agent 工具调用时被拒，不会卡 binding。
 * The result cap shares SUBAGENT_SUMMARY_MAX_BYTES so a long compose proposal can
 * reach TaskOutput; the prompt cap stays at 4096 (over-length prompts are rejected
 * at Agent-tool call time, never stranding a binding). */
const NOVEL_SUBAGENT_LIMITS = Object.freeze({
  maximumPromptBytes: 4096,
  maximumArtifactReferences: 4,
  maximumResultBytes: SUBAGENT_SUMMARY_MAX_BYTES,
} as const);

/** 生产 novel_explorer / novel_compose 子代理定义。Production subagent definitions. */
export const NOVEL_SUBAGENT_DEFINITIONS: readonly SubagentDefinition[] =
  Object.freeze([
    Object.freeze({
      agentType: "novel_explorer",
      definitionVersion: "1.0.0",
      label: "只读探索",
      description:
        "只读子代理：读取大纲、人物、地点、段落、卷与章节，返回简洁的文本性发现。",
      toolPolicyId: NOVEL_EXPLORER_TOOL_POLICY_ID,
    }),
    Object.freeze({
      agentType: "novel_compose",
      definitionVersion: "1.0.0",
      label: "创作助手",
      description:
        "读取当前故事状态，以文本形式起草大纲与正文设计提案。",
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
