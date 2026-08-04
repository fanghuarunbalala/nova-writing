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
assert.equal(composition.registry.size, 1);
assert.equal(composition.registry.has("TodoWrite"), true);
assert.ok(composition.groups instanceof ToolGroupCatalog);
assert.ok(composition.promptBuilder instanceof SystemPromptBuilder);
assert.ok(composition.digester instanceof NodeSha256PromptDigester);

console.log("Novel conversation manifest composition smoke passed");
