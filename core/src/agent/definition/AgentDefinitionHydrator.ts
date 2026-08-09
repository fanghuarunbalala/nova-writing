/** Reconstructs immutable Agent Definition classes from persisted snapshots. */
import {
  AGENT_DEFINITION_SCHEMA_VERSION,
  AgentCommunicationPolicy,
  AgentDefinition,
  AgentDelegationPolicy,
  AgentToolPolicy,
  type AgentDefinitionSnapshot,
} from "./AgentDefinition.js";
import {
  InlinePromptItem,
  PromptRecipe,
  PromptSectionItem,
} from "../../prompt/index.js";

export function hydrateAgentDefinition(
  snapshot: AgentDefinitionSnapshot,
): AgentDefinition {
  if (snapshot.schemaVersion !== AGENT_DEFINITION_SCHEMA_VERSION) {
    throw new TypeError("Agent Definition schema version is unsupported");
  }
  return new AgentDefinition({
    agentType: snapshot.agentType,
    definitionVersion: snapshot.definitionVersion,
    label: snapshot.label,
    description: snapshot.description,
    promptRecipe: new PromptRecipe(
      snapshot.promptRecipe.items.map((item) => {
        if (item.kind === "section") {
          return new PromptSectionItem(item.sectionId, item.version);
        }
        if (item.kind === "inline") {
          return new InlinePromptItem(item.content);
        }
        throw new TypeError("Agent Definition Prompt item is unsupported");
      }),
    ),
    tools: new AgentToolPolicy(snapshot.tools),
    delegation: new AgentDelegationPolicy(snapshot.delegation),
    communication: new AgentCommunicationPolicy(snapshot.communication.role),
    runtimePolicyId: snapshot.runtimePolicyId,
    // 旧持久化快照缺该字段 → undefined → 构造器回退空集（不 bump schemaVersion，非破坏）。
    // Older persisted snapshots lack the field → undefined → constructor falls back to empty (no schemaVersion bump, non-breaking).
    nudgeEnablement: snapshot.nudgeEnablement,
  });
}
