/**
 * Compose 落库收口冒烟：批准后写审计记录并归档 design 文件。
 * Smoke for compose settlement: audit record and design-file archive after approval.
 */
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  ComposeModeStateProvider,
  ComposeToolService,
} from "../dist/index.js";
import {
  NodeNovelStoreLocator,
  NodeWorkspaceStoreLocator,
  SqliteNovelCanonicalStore,
  SqliteNovelComposeCommitStore,
} from "../dist/node/index.js";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "compose-commit-smoke-"));
const workspaceRoot = path.join(root, "workspace");
await fs.mkdir(workspaceRoot, { recursive: true });
const workspace = await new NodeWorkspaceStoreLocator({
  storageRoot: path.join(root, "storage"),
}).resolve(workspaceRoot);
const location = await new NodeNovelStoreLocator().resolve(workspace);
const canonicalStore = await SqliteNovelCanonicalStore.open({
  location,
  logger: undefined,
});
const novelId = (await canonicalStore.getMetadata()).novelId;
await canonicalStore.close();

const events = [];
const eventSink = {
  async append(event) {
    events.push(event);
    return {
      status: "recorded",
      conversationId: event.conversationId,
      eventId: `evt-${events.length}`,
      sequence: events.length,
      recordedAt: "2026-08-07T00:00:00.000Z",
    };
  },
};
const designRoot = path.join(workspaceRoot, ".novel", "design");
const composeState = new ComposeModeStateProvider();
const service = new ComposeToolService({
  composeState,
  designRoot,
  eventSink,
  commitRecorder: new SqliteNovelComposeCommitStore({ location, novelId }),
});

const conversationId = "conversation:compose-commit";
const designFilePath = service.designFilePathFor(conversationId);

await service.begin(conversationId, "第三章设计");
await fs.writeFile(designFilePath, "第三章正文草稿\n", "utf8");
await service.exit(conversationId);

assert.equal(composeState.snapshot(conversationId).phase, "applied");
assert.equal(composeState.snapshot(conversationId).active, false);
assert.equal(events.at(-1).getEventType(), "novel.compose.applied");

// design 文件已归档
const archivePath = path.join(designRoot, "archive", "conversation-compose-commit.md");
assert.equal(await fs.readFile(archivePath, "utf8"), "第三章正文草稿\n");
await assert.rejects(fs.access(designFilePath));

// 审计记录已写入 novel_compose_commits
const database = new DatabaseSync(location.canonicalDatabasePath, {
  readOnly: true,
});
try {
  const row = database
    .prepare(
      `SELECT design_id, conversation_id, novel_id, content_digest, archive_path
         FROM novel_compose_commits WHERE design_id = ?`,
    )
    .get("conversation-compose-commit");
  assert.ok(row);
  assert.equal(row.conversation_id, conversationId);
  assert.equal(row.novel_id, novelId);
  assert.equal(row.archive_path, archivePath);
  assert.equal(row.content_digest.length, 64);
} finally {
  database.close();
}

await fs.rm(root, { recursive: true, force: true });
console.log("novel compose commit smoke passed");
