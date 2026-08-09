import assert from "node:assert/strict";
import {
  ToolRegistryView,
  novelAgentDefinition,
  novelComposeAgentDefinition,
  novelExplorerAgentDefinition,
} from "../dist/index.js";
import { createNovelConversationManifestComposition } from "../dist/node/index.js";

// Production assembly: full Novel tool registry + TodoWrite + subagent tools.
const composition = createNovelConversationManifestComposition();
const registry = composition.registry;
const groups = composition.groups;

function viewFor(definition) {
  return new ToolRegistryView({
    registry,
    groups,
    policy: definition.tools.toSnapshot(),
  });
}

const expectedReadOnly = Object.freeze([
  "TodoWrite",
  "NovelOutlineRead",
  "NovelCharacterRead",
  "NovelLocationRead",
  "NovelParagraphRead",
  "NovelVolumeRead",
  "NovelChapterRead",
]);

// Novel 1.4.0 exposes the full tool set plus the three subagent execution tools.
assert.equal(novelAgentDefinition.definitionVersion, "1.4.0");
assert.deepEqual(
  novelAgentDefinition.delegation.allowedAgentTypes,
  ["novel_explorer", "novel_compose"],
);
const novelView = viewFor(novelAgentDefinition);
assert.ok(novelView.has("TodoWrite"), "novel view must expose TodoWrite");
for (const toolName of ["Agent", "TaskOutput", "TaskStop"]) {
  assert.ok(novelView.has(toolName), `novel view must expose ${toolName}`);
}
for (const toolName of expectedReadOnly) {
  assert.ok(novelView.has(toolName), `novel view must expose ${toolName}`);
}
assert.ok(novelView.has("NovelDelete"), "novel view must expose NovelDelete");
assert.ok(
  !novelView.has("NovelDraftCommit"),
  "novel view must not expose draft-only tools",
);

// Explorer and Compose expose exactly the seven read-only tools.
for (const definition of [
  novelExplorerAgentDefinition,
  novelComposeAgentDefinition,
]) {
  assert.equal(definition.definitionVersion, "1.0.0");
  assert.equal(definition.delegation.mode, "disabled");
  const view = viewFor(definition);
  const allowed = view
    .listAllowed()
    .map((tool) => tool.descriptor.name)
    .sort();
  assert.deepEqual(
    allowed,
    [...expectedReadOnly].sort(),
    `${definition.agentType} must expose exactly the 7 read-only tools`,
  );
  assert.ok(!view.has("Agent"), `${definition.agentType} must not expose Agent`);
  assert.ok(
    !view.has("NovelDelete"),
    `${definition.agentType} must not expose NovelDelete`,
  );
}

console.log("Novel explorer/compose definitions smoke passed");
