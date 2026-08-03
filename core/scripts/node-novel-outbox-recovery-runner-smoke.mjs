import assert from "node:assert/strict";
import {
  NOVEL_DRAFT_SESSION_STATUS,
  captureNovelDraftSession,
  captureNovelDraftSessionId,
  captureNovelId,
  captureNovelRevision,
  captureNovelTimestamp,
} from "../dist/index.js";
import { NodeNovelOutboxRecoveryRunner } from "../dist/node/index.js";

const novelId = captureNovelId("novel_outbox_recovery_runner");
const active = session("draft_active", NOVEL_DRAFT_SESSION_STATUS.active);
const committed = session("draft_committed", NOVEL_DRAFT_SESSION_STATUS.committed);
const candidate = session("draft_candidate", NOVEL_DRAFT_SESSION_STATUS.rebasing);
const opened = [];
const closed = [];
const removed = [];
const runner = new NodeNovelOutboxRecoveryRunner({
  location: {
    workspaceId: "workspace_outbox_recovery",
    canonicalDatabasePath: "/redacted/canonical",
    stagingDir: "/redacted/staging",
    historyDir: "/redacted/history",
    commitHistoryDir: "/redacted/commits",
    artifactDir: "/redacted/artifacts",
  },
  novelId,
  draftStore: { async listDraftSessions() { return [active, committed]; } },
  candidateStore: { async listCandidates() { return [{ session: candidate }]; } },
  resolvedCandidateStore: { async listResolvedCandidates() { return []; } },
  snapshotter: {
    async listDraftSnapshotIds() { return [active.id, committed.id, candidate.id]; },
    async removeDraftSnapshot(receivedNovelId, draftSessionId) {
      assert.equal(receivedNovelId, novelId);
      removed.push(draftSessionId);
    },
  },
  publisher: { async publish() { throw new Error("unused"); } },
  storeFactory: {
    async openCanonical() { return store({ kind: "canonical" }); },
    async openDraft({ session: draftSession }) {
      return store({ kind: "draft", draftSessionId: draftSession.id });
    },
  },
});
const result = await runner.dispatchPending();
assert.equal(result.sourceResults.length, 4);
assert.equal(result.removedTerminalSnapshotCount, 1);
assert.deepEqual(removed, [committed.id]);
assert.deepEqual(closed, opened.toReversed());

function store(source) {
  const key = source.kind === "canonical" ? "canonical" : source.draftSessionId;
  opened.push(key);
  return {
    source,
    async listPending() { return { entries: [], hasMore: false }; },
    async recordAttempt() { throw new Error("unused"); },
    async markPublished() { throw new Error("unused"); },
    async close() { closed.push(key); },
  };
}

function session(id, status) {
  const timestamp = captureNovelTimestamp("2026-08-03T03:00:00.000Z");
  return captureNovelDraftSession({
    id: captureNovelDraftSessionId(id),
    novelId,
    ownerConversationId: `conversation-${id}`,
    baseRevision: captureNovelRevision("revision_outbox_recovery"),
    status,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...(status === NOVEL_DRAFT_SESSION_STATUS.committed
      ? { terminalAt: timestamp }
      : {}),
  });
}

console.log("node novel outbox recovery runner smoke passed");
