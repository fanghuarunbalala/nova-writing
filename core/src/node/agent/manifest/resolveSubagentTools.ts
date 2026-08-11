/**
 * 从 ToolRegistry + 子代理 AgentDefinition 策略解析每个子代理的可用工具名。
 * Resolves each subagent's available tool names from the ToolRegistry and the
 * subagent AgentDefinition tool policy.
 */
import {
  novelComposeAgentDefinition,
  novelExplorerAgentDefinition,
} from "../../../agent/definitions/index.js";
import type { AgentDefinition } from "../../../agent/definition/index.js";
import type { ToolGroupCatalog } from "../../../tooling/group/index.js";
import { ToolRegistryView } from "../../../tooling/registry/index.js";
import type { ToolRegistry } from "../../../tooling/registry/index.js";

const DEFINITION_BY_TYPE: Record<string, AgentDefinition> = Object.freeze({
  novel_explorer: novelExplorerAgentDefinition,
  novel_compose: novelComposeAgentDefinition,
});

/** 构造 agentType → 可用工具名的解析器（基于 registry + groups 的运行时策略）。 */
/** Builds an agentType -> available-tool-names resolver from the runtime policy. */
export function createSubagentToolNameResolver(options: {
  readonly registry: ToolRegistry;
  readonly groups: ToolGroupCatalog;
}): (agentType: string) => readonly string[] {
  return (agentType) => {
    const definition = DEFINITION_BY_TYPE[agentType];
    if (definition === undefined) return [];
    return new ToolRegistryView({
      registry: options.registry,
      groups: options.groups,
      policy: definition.tools.toSnapshot(),
    }).listAllowed().map((tool) => tool.descriptor.name).sort();
  };
}
