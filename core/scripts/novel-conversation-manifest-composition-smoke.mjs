import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  SystemPromptBuilder,
  ToolGroupCatalog,
  ToolRegistry,
} from "../dist/index.js";
import {
  NodeSha256PromptDigester,
  createNovelConversationManifestComposition,
} from "../dist/node/index.js";

const digester = new NodeSha256PromptDigester();
assert.equal(digester.algorithm, "sha256");
const digest = await digester.digest("manifest composition smoke");
assert.match(digest, /^sha256:[0-9a-f]{64}$/);
assert.equal(
  digest,
  `sha256:${createHash("sha256").update("manifest composition smoke", "utf8").digest("hex")}`,
);

const composition = createNovelConversationManifestComposition();
assert.ok(composition.registry instanceof ToolRegistry);
assert.equal(composition.registry.size, 24);
assert.equal(composition.registry.has("TodoWrite"), true);
assert.equal(composition.registry.has("NovelOutlineRead"), true);
assert.equal(composition.registry.has("NovelOutlineWrite"), true);
assert.equal(composition.registry.has("NovelOutlineEdit"), true);
assert.equal(composition.registry.has("NovelCharacterRead"), true);
assert.equal(composition.registry.has("NovelCharacterWrite"), true);
assert.equal(composition.registry.has("NovelCharacterEdit"), true);
assert.equal(composition.registry.has("NovelLocationRead"), true);
assert.equal(composition.registry.has("NovelLocationWrite"), true);
assert.equal(composition.registry.has("NovelLocationEdit"), true);
assert.equal(composition.registry.has("NovelParagraphRead"), true);
assert.equal(composition.registry.has("NovelParagraphWrite"), true);
assert.equal(composition.registry.has("NovelParagraphEdit"), true);
assert.equal(composition.registry.has("NovelVolumeRead"), true);
assert.equal(composition.registry.has("NovelVolumeWrite"), true);
assert.equal(composition.registry.has("NovelVolumeEdit"), true);
assert.equal(composition.registry.has("NovelChapterRead"), true);
assert.equal(composition.registry.has("NovelChapterWrite"), true);
assert.equal(composition.registry.has("NovelChapterEdit"), true);
assert.equal(composition.registry.has("NovelDelete"), true);
assert.equal(composition.registry.has("NovelDraftStatus"), true);
assert.equal(composition.registry.has("NovelDraftCommit"), true);
assert.equal(composition.registry.has("NovelDraftRollback"), true);
assert.equal(composition.registry.has("NovelDraftRebase"), true);
assert.ok(composition.groups instanceof ToolGroupCatalog);
assert.ok(composition.promptBuilder instanceof SystemPromptBuilder);
assert.ok(composition.digester instanceof NodeSha256PromptDigester);

console.log("Novel conversation manifest composition smoke passed");
