import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  NOVEL_CHANGE_SET_VERSION,
  NOVEL_COMMIT_PAYLOAD_VERSION,
  NovelCommitHistoryIntegrityError,
  NovelCommitPayloadIdentityConflictError,
  canonicalizeNovelCommitPayload,
  captureCharacterId,
  captureNovelChangeSetDigest,
  captureNovelCommitId,
  captureNovelDraftSessionId,
  captureNovelId,
  captureNovelOperationId,
  captureNovelRevision,
  captureNovelTimestamp,
  createCharacterCreateOperation,
} from "../dist/index.js";
import {
  NodeNovelCommitHistoryStore,
  NodeSha256NovelOperationDigester,
} from "../dist/node/index.js";

class CollectingLogger {
  constructor(entries = [], bindings = {}) {
    this.entries = entries;
    this.bindings = bindings;
  }
  debug(event, fields = {}) { this.record("debug", event, fields); }
  info(event, fields = {}) { this.record("info", event, fields); }
  warn(event, fields = {}) { this.record("warn", event, fields); }
  error(event, fields = {}) { this.record("error", event, fields); }
  child(bindings) {
    return new CollectingLogger(this.entries, { ...this.bindings, ...bindings });
  }
  record(level, event, fields) {
    this.entries.push({ level, event, fields: { ...this.bindings, ...fields } });
  }
}

async function createPayload(commitIdValue, name) {
  const operation = createCharacterCreateOperation({
    operationId: captureNovelOperationId(`operation_${commitIdValue}`),
    id: captureCharacterId(`character_${commitIdValue}`),
    profile: { name, aliases: [] },
    timestamp: captureNovelTimestamp("2026-08-02T10:00:00.000Z"),
  });
  const operationDigest = await new NodeSha256NovelOperationDigester().digest(operation);
  return {
    payloadVersion: NOVEL_COMMIT_PAYLOAD_VERSION,
    commitId: captureNovelCommitId(commitIdValue),
    novelId: captureNovelId("novel_commit_history"),
    draftSessionId: captureNovelDraftSessionId("draft_commit_history"),
    ownerConversationId: "conversation-commit-history",
    baseRevision: captureNovelRevision("revision_commit_history_base"),
    resultRevision: captureNovelRevision(`revision_${commitIdValue}`),
    changeSetDigest: captureNovelChangeSetDigest(
      `sha256:${"1".repeat(64)}`,
    ),
    operationCount: 1,
    committedAt: captureNovelTimestamp("2026-08-02T10:01:00.000Z"),
    operations: [{ sequence: 1, operationDigest, operation }],
  };
}

function assertRedacted(entries, forbidden) {
  const serialized = JSON.stringify(entries);
  for (const value of forbidden) assert.equal(serialized.includes(value), false);
  for (const entry of entries) {
    for (const key of Object.keys(entry.fields)) {
      assert.equal(["payload", "content", "text", "path", "message", "stack", "cause"].includes(key), false);
    }
  }
}

const root = await mkdtemp(join(tmpdir(), "novel-commit-history-"));
const commitHistoryDir = join(root, "novel-history", "commits");
const logs = [];
const store = new NodeNovelCommitHistoryStore({
  location: {
    workspaceId: "workspace-commit-history",
    canonicalDatabasePath: join(root, "novel.sqlite"),
    stagingDir: join(root, "novel-staging"),
    historyDir: join(root, "novel-history"),
    commitHistoryDir,
    artifactDir: join(root, "novel-artifacts"),
  },
  logger: new CollectingLogger(logs),
});

try {
  assert.equal(NOVEL_CHANGE_SET_VERSION, 1);
  const secret = "FORBIDDEN_COMMIT_PAYLOAD_TEXT";
  const payloadA = await createPayload("commit_payload_a", secret);
  const preparedA = await store.prepare(payloadA);
  assert.equal(preparedA.payloadRef, "commit_payload_a.json");
  assert.equal(preparedA.payloadDigest.startsWith("sha256:"), true);
  const bytesA = await readFile(join(commitHistoryDir, preparedA.payloadRef));
  assert.equal(bytesA.byteLength, preparedA.payloadSize);
  assert.equal(bytesA.toString("utf8"), canonicalizeNovelCommitPayload(payloadA));
  assert.equal(bytesA.at(-1), "}".charCodeAt(0));
  await store.verify(preparedA);
  assert.deepEqual(await store.prepare(payloadA), preparedA);

  await assert.rejects(
    store.prepare(await createPayload("commit_payload_a", "Different content")),
    (error) => error instanceof NovelCommitPayloadIdentityConflictError,
  );

  const payloadB = await createPayload("commit_payload_b", "Orphan content");
  const preparedB = await store.prepare(payloadB);
  await writeFile(
    join(commitHistoryDir, ".commit_payload_temp.00000000-0000-4000-8000-000000000000.tmp"),
    "temporary",
  );
  await writeFile(join(commitHistoryDir, "unrecognized.keep"), "keep");
  const reconciled = await store.reconcile([preparedA]);
  assert.equal(reconciled.removedTemporaryCount, 1);
  assert.equal(reconciled.removedOrphanCount, 1);
  assert.deepEqual(reconciled.missing, []);
  await assert.rejects(readFile(join(commitHistoryDir, preparedB.payloadRef)));
  assert.equal((await readFile(join(commitHistoryDir, "unrecognized.keep"), "utf8")), "keep");

  await unlink(join(commitHistoryDir, preparedA.payloadRef));
  const missing = await store.reconcile([preparedA]);
  assert.equal(missing.missing.length, 1);
  assert.equal(missing.missing[0].commitId, preparedA.commitId);
  assert.deepEqual(await store.prepare(payloadA), preparedA);
  await writeFile(join(commitHistoryDir, preparedA.payloadRef), "corrupt");
  await assert.rejects(
    store.verify(preparedA),
    (error) => error instanceof NovelCommitHistoryIntegrityError,
  );
  assertRedacted(logs, [root, secret, "Different content", "Orphan content"]);
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("novel commit history smoke passed");
