/** Reconstructs immutable Agent Manifest classes from persisted JSON snapshots. */
import { hydrateAgentDefinition } from "../definition/AgentDefinitionHydrator.js";
import {
  AGENT_MANIFEST_SCHEMA_VERSION,
  AgentManifest,
  AgentManifestDelegation,
  AgentManifestPrompt,
  AgentManifestTool,
  type AgentManifestSnapshot,
} from "./AgentManifest.js";
import {
  ResolvedInlinePromptItem,
  ResolvedPromptRecipe,
  ResolvedPromptSectionItem,
} from "./ResolvedPromptRecipe.js";

export function hydrateAgentManifest(
  snapshot: AgentManifestSnapshot,
): AgentManifest {
  if (snapshot.schemaVersion !== AGENT_MANIFEST_SCHEMA_VERSION) {
    throw new TypeError("Agent Manifest schema version is unsupported");
  }
  const definition = hydrateAgentDefinition(snapshot.definition);
  if (
    definition.agentType !== snapshot.agentType ||
    definition.definitionVersion !== snapshot.definitionVersion
  ) {
    throw new TypeError("Agent Manifest Definition identity is inconsistent");
  }
  return new AgentManifest({
    manifestId: snapshot.manifestId,
    manifestDigest: snapshot.manifestDigest,
    definition,
    promptRecipe: new ResolvedPromptRecipe(
      snapshot.promptRecipe.items.map((item) => {
        if (item.kind === "section") {
          return new ResolvedPromptSectionItem({
            sectionId: item.sectionId,
            version: item.version,
          });
        }
        if (item.kind === "inline") {
          return new ResolvedInlinePromptItem({
            sourceId: item.sourceId,
            content: item.content,
          });
        }
        throw new TypeError("Agent Manifest Prompt item is unsupported");
      }),
    ),
    compiledPrompt: new AgentManifestPrompt(snapshot.compiledPrompt),
    tools: snapshot.tools.map((tool) => new AgentManifestTool(tool)),
    delegation: new AgentManifestDelegation(snapshot.delegation),
    communicationRole: snapshot.communicationRole,
    runtimePolicyId: snapshot.runtimePolicyId,
    createdAt: snapshot.createdAt,
  });
}
