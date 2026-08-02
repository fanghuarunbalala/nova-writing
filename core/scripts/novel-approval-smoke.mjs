import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  NovelApprovalRequiredError,
  NovelDraftSessionService,
  captureCharacterId,
  captureLocationId,
  captureNovelCommitId,
  captureNovelDraftSessionId,
  captureNovelOperationId,
  captureNovelRevision,
  captureNovelTimestamp,
} from "../dist/index.js";
import {
  NodeNovelStoreLocator,
  NodeWorkspaceStoreLocator,
  SqliteNovelCanonicalStore,
  SqliteNovelDraftStore,
  SqliteNovelSnapshotter,
  createNodeNovelEntityApplication,
} from "../dist/node/index.js";

class DraftIdentityFactory {
  constructor(ids) { this.ids = [...ids]; }
  createDraftSessionId() { return captureNovelDraftSessionId(this.ids.shift()); }
}
class OperationIdentityFactory {
  constructor() { this.sequence = 0; }
  createOperationId() {
    this.sequence += 1;
    return captureNovelOperationId(`approval_operation_${this.sequence}`);
  }
}
class SequenceClock {
  constructor() { this.offset = 0; }
  now() {
    return captureNovelTimestamp(
      new Date(Date.UTC(2026, 7, 2, 18, 0, 0, this.offset++)).toISOString(),
    );
  }
}
class CollectingLogger {
  constructor(entries = [], bindings = {}) { this.entries = entries; this.bindings = bindings; }
  debug(event, fields = {}) { this.record("debug", event, fields); }
  info(event, fields = {}) { this.record("info", event, fields); }
  warn(event, fields = {}) { this.record("warn", event, fields); }
  error(event, fields = {}) { this.record("error", event, fields); }
  child(bindings) { return new CollectingLogger(this.entries, { ...this.bindings, ...bindings }); }
  record(level, event, fields) { this.entries.push({ level, event, fields: { ...this.bindings, ...fields } }); }
}

const root = await mkdtemp(join(tmpdir(), "novel-approval-"));
let canonicalStore;
let draftStore;
try {
  const workspaceRoot = join(root, "workspace");
  await mkdir(workspaceRoot, { recursive: true });
  const workspace = await new NodeWorkspaceStoreLocator({ storageRoot: join(root, "storage") }).resolve(workspaceRoot);
  const location = await new NodeNovelStoreLocator().resolve(workspace);
  const clock = new SequenceClock();
  const logs = [];
  const logger = new CollectingLogger(logs);
  canonicalStore = await SqliteNovelCanonicalStore.open({
    location,
    revisionFactory: { createRevision: () => captureNovelRevision("revision_approval_base") },
    clock,
    logger,
  });
  const canonical = await canonicalStore.getMetadata();
  draftStore = await SqliteNovelDraftStore.open({ location, novelId: canonical.novelId, logger });
  const drafts = new NovelDraftSessionService({
    canonicalStore,
    draftStore,
    snapshotter: new SqliteNovelSnapshotter({ location, novelId: canonical.novelId, logger }),
    identityFactory: new DraftIdentityFactory(["draft_approval_a", "draft_approval_b"]),
    clock,
    logger,
  });
  const application = createNodeNovelEntityApplication({
    location,
    novelId: canonical.novelId,
    identityFactory: new OperationIdentityFactory(),
    clock,
    logger,
    requireApproval: true,
  });
  const sessionA = await drafts.startDraft("conversation-approval-a");
  await application.characters.create(sessionA, captureCharacterId("character_approval"), {
    name: "FORBIDDEN_APPROVAL_CHARACTER",
    aliases: [],
  });
  const changeSetA = await application.changeSets.build(sessionA);
  await assert.rejects(
    application.commits.commit(sessionA, {
      commitId: captureNovelCommitId("commit_approval_missing"),
      resultRevision: captureNovelRevision("revision_approval_missing"),
    }),
    NovelApprovalRequiredError,
  );
  const grantedA = await application.approvals.grant(changeSetA);
  assert.equal(grantedA.status, "recorded");
  assert.equal((await application.approvals.grant(changeSetA)).status, "duplicate");

  const restarted = createNodeNovelEntityApplication({
    location,
    novelId: canonical.novelId,
    identityFactory: new OperationIdentityFactory(),
    clock,
    logger,
    requireApproval: true,
  });
  assert.equal((await restarted.commits.commit(sessionA, {
    commitId: captureNovelCommitId("commit_approval_a"),
    resultRevision: captureNovelRevision("revision_approval_a"),
  })).status, "committed");

  const sessionB = await drafts.startDraft("conversation-approval-b");
  await application.locations.create(sessionB, captureLocationId("location_approval"), {
    name: "FORBIDDEN_APPROVAL_LOCATION",
    aliases: [],
  });
  const changeSetB = await application.changeSets.build(sessionB);
  await application.approvals.grant(changeSetB);
  assert.equal(await application.approvals.invalidate(sessionB, "draft-replaced"), "invalidated");
  await assert.rejects(
    application.commits.commit(sessionB, {
      commitId: captureNovelCommitId("commit_approval_invalidated"),
      resultRevision: captureNovelRevision("revision_approval_invalidated"),
    }),
    NovelApprovalRequiredError,
  );
  await application.approvals.grant(changeSetB);
  assert.equal((await application.commits.commit(sessionB, {
    commitId: captureNovelCommitId("commit_approval_b"),
    resultRevision: captureNovelRevision("revision_approval_b"),
  })).status, "committed");

  const database = new DatabaseSync(join(location.stagingDir, sessionB.ownerConversationId, sessionB.id, "draft.sqlite"), { readOnly: true });
  const approvals = database
    .prepare("SELECT status, invalidation_reason FROM draft_approvals ORDER BY granted_at")
    .all()
    .map((row) => ({ ...row }));
  database.close();
  assert.deepEqual(approvals, [
    { status: "invalidated", invalidation_reason: "draft-replaced" },
    { status: "active", invalidation_reason: null },
  ]);
  const serializedLogs = JSON.stringify(logs);
  assert.equal(serializedLogs.includes("FORBIDDEN_APPROVAL_CHARACTER"), false);
  assert.equal(serializedLogs.includes("FORBIDDEN_APPROVAL_LOCATION"), false);
} finally {
  await draftStore?.close();
  await canonicalStore?.close();
  await rm(root, { recursive: true, force: true });
}
console.log("novel approval smoke passed");
