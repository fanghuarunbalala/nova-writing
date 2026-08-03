/** Reconstructs immutable Agent Manifest classes from persisted JSON snapshots. */
import { hydrateAgentDefinition } from "../definition/AgentDefinitionHydrator.js";
import { AgentToolPolicy } from "../definition/AgentDefinition.js";
import {
  AGENT_MANIFEST_SCHEMA_VERSION,
  LEGACY_AGENT_MANIFEST_SCHEMA_VERSION,
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
import {
  AgentCapabilityProfile,
  ResolvedAgentCapabilities,
  createLegacyResolvedAgentCapabilities,
} from "../capability/index.js";

export function hydrateAgentManifest(
  snapshot: AgentManifestSnapshot,
): AgentManifest {
  if (
    snapshot.schemaVersion !== AGENT_MANIFEST_SCHEMA_VERSION &&
    snapshot.schemaVersion !== LEGACY_AGENT_MANIFEST_SCHEMA_VERSION
  ) {
    throw new TypeError("Agent Manifest schema version is unsupported");
  }
  const definition = hydrateAgentDefinition(snapshot.definition);
  if (
    definition.agentType !== snapshot.agentType ||
    definition.definitionVersion !== snapshot.definitionVersion
  ) {
    throw new TypeError("Agent Manifest Definition identity is inconsistent");
  }
  const promptRecipe = new ResolvedPromptRecipe(
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
  );
  const capabilityProfile = snapshot.schemaVersion === AGENT_MANIFEST_SCHEMA_VERSION
    ? hydrateCapabilities(snapshot.capabilityProfile)
    : createLegacyResolvedAgentCapabilities(
      definition,
      promptRecipe.items
        .filter((item): item is ResolvedPromptSectionItem =>
          item instanceof ResolvedPromptSectionItem)
        .map((item) => item.sectionId),
    );
  return new AgentManifest({
    manifestId: snapshot.manifestId,
    manifestDigest: snapshot.manifestDigest,
    definition,
    promptRecipe,
    compiledPrompt: new AgentManifestPrompt(snapshot.compiledPrompt),
    tools: snapshot.tools.map((tool) => new AgentManifestTool(tool)),
    delegation: new AgentManifestDelegation(snapshot.delegation),
    capabilityProfile,
    communicationRole: snapshot.communicationRole,
    runtimePolicyId: snapshot.runtimePolicyId,
    createdAt: snapshot.createdAt,
  });
}

function hydrateCapabilities(
  snapshot: AgentManifestSnapshot["capabilityProfile"],
): ResolvedAgentCapabilities {
  const profile = new AgentCapabilityProfile({
    profileId: snapshot.profileId,
    version: snapshot.profileVersion,
    communicationRole: snapshot.communicationRole,
  });
  return new ResolvedAgentCapabilities({
    profile,
    promptSectionIds: snapshot.promptSectionIds,
    toolPolicy: new AgentToolPolicy(snapshot.toolPolicy),
    channelIds: snapshot.channelIds,
  });
}
