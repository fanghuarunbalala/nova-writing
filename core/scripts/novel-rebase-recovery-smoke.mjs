import assert from "node:assert/strict";
import {
  NOVEL_DRAFT_SESSION_STATUS,
  NOVEL_RECOVERY_PHASE,
  NovelRebaseRecoveryService,
  captureNovelDraftSession,
  captureNovelDraftSessionId,
  captureNovelId,
  captureNovelRebaseCandidate,
  captureNovelResolvedRebaseCandidate,
  captureNovelRevision,
  captureNovelTimestamp,
} from "../dist/index.js";

const novelId = captureNovelId("novel_rebase_recovery");
const source = session("draft_source", "revision_base", NOVEL_DRAFT_SESSION_STATUS.active);
const valid = candidate("draft_candidate_valid", source, "revision_current", 1);
const missingSnapshot = candidate(
  "draft_candidate_missing_snapshot",
  source,
  "revision_newer",
  0,
);
const resolved = resolvedCandidate(
  "draft_candidate_resolved",
  valid,
  "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  1,
);
const invalidResolved = resolvedCandidate(
  "draft_candidate_invalid_resolved",
  valid,
  "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  0,
);
const snapshots = new Map([
  [valid.session.id, snapshot(valid.session, source.id)],
  [resolved.session.id, snapshot(resolved.session, source.id)],
  [invalidResolved.session.id, snapshot(invalidResolved.session, source.id)],
]);
const sequences = new Map([
  [valid.session.id, sequence(1)],
  [resolved.session.id, sequence(1)],
  [invalidResolved.session.id, sequence(0)],
]);
const candidates = [valid, missingSnapshot];
const resolvedCandidates = [resolved, invalidResolved];
const removedSnapshots = [];
const removedCandidates = [];
const removedResolvedCandidates = [];
const service = new NovelRebaseRecoveryService({
  draftStore: {
    async getDraftSession(receivedNovelId, draftSessionId) {
      assert.equal(receivedNovelId, novelId);
      return draftSessionId === source.id ? source : undefined;
    },
  },
  snapshotter: {
    async inspectDraftSnapshot(receivedNovelId, draftSessionId) {
      assert.equal(receivedNovelId, novelId);
      return snapshots.get(draftSessionId);
    },
    async removeDraftSnapshot(receivedNovelId, draftSessionId) {
      assert.equal(receivedNovelId, novelId);
      removedSnapshots.push(draftSessionId);
      snapshots.delete(draftSessionId);
    },
  },
  candidateStore: {
    async listCandidates(receivedNovelId) {
      assert.equal(receivedNovelId, novelId);
      return candidates;
    },
    async removeCandidate(receivedNovelId, draftSessionId) {
      assert.equal(receivedNovelId, novelId);
      removedCandidates.push(draftSessionId);
    },
  },
  resolvedCandidateStore: {
    async listResolvedCandidates(receivedNovelId) {
      assert.equal(receivedNovelId, novelId);
      return resolvedCandidates;
    },
    async removeResolvedCandidate(receivedNovelId, draftSessionId) {
      assert.equal(receivedNovelId, novelId);
      removedResolvedCandidates.push(draftSessionId);
    },
  },
  operationStore: {
    async readOperationSequence(candidateSession) {
      const value = sequences.get(candidateSession.id);
      if (value === undefined) throw new Error("missing");
      return value;
    },
  },
  resolutionPlanStore: {
    async getPlan(candidateSession) {
      assert.equal(candidateSession.id, valid.session.id);
      return {
        digest: resolved.resolutionPlanDigest,
        sourceDraftSessionId: source.id,
        conflictedCandidateDraftSessionId: valid.session.id,
        baseRevision: valid.session.baseRevision,
        effectiveOperationCount: resolved.operationCount,
      };
    },
  },
});

const result = await service.recover(novelId);
assert.equal(service.phase, NOVEL_RECOVERY_PHASE.rebase);
assert.deepEqual(result, {
  phase: NOVEL_RECOVERY_PHASE.rebase,
  inspectedCount: 4,
  repairedCount: 0,
  removedCount: 2,
  retainedCount: 2,
  publishedCount: 0,
});
assert.deepEqual(removedResolvedCandidates, [invalidResolved.session.id]);
assert.deepEqual(removedCandidates, [missingSnapshot.session.id]);
assert.deepEqual(removedSnapshots, [
  invalidResolved.session.id,
  missingSnapshot.session.id,
]);

function session(id, baseRevision, status) {
  return captureNovelDraftSession({
    id: captureNovelDraftSessionId(id),
    novelId,
    ownerConversationId: "conversation-recovery",
    baseRevision: captureNovelRevision(baseRevision),
    status,
    createdAt: captureNovelTimestamp("2026-08-03T00:00:00.000Z"),
    updatedAt: captureNovelTimestamp("2026-08-03T00:00:00.000Z"),
  });
}

function candidate(id, sourceSession, baseRevision, operationCount) {
  const preparedAt = captureNovelTimestamp("2026-08-03T00:01:00.000Z");
  return captureNovelRebaseCandidate({
    sourceDraftSessionId: sourceSession.id,
    sourceBaseRevision: sourceSession.baseRevision,
    session: captureNovelDraftSession({
      id: captureNovelDraftSessionId(id),
      novelId,
      ownerConversationId: sourceSession.ownerConversationId,
      baseRevision: captureNovelRevision(baseRevision),
      status: NOVEL_DRAFT_SESSION_STATUS.rebasing,
      createdAt: preparedAt,
      updatedAt: preparedAt,
    }),
    operationCount,
    lastOperationSequence: operationCount,
    preparedAt,
  });
}

function resolvedCandidate(id, conflicted, digest, operationCount) {
  const preparedAt = captureNovelTimestamp("2026-08-03T00:02:00.000Z");
  return captureNovelResolvedRebaseCandidate({
    sourceDraftSessionId: conflicted.sourceDraftSessionId,
    conflictedCandidateDraftSessionId: conflicted.session.id,
    resolutionPlanDigest: digest,
    session: captureNovelDraftSession({
      id: captureNovelDraftSessionId(id),
      novelId,
      ownerConversationId: conflicted.session.ownerConversationId,
      baseRevision: conflicted.session.baseRevision,
      status: NOVEL_DRAFT_SESSION_STATUS.rebasing,
      createdAt: preparedAt,
      updatedAt: preparedAt,
    }),
    operationCount,
    lastOperationSequence: operationCount,
    preparedAt,
  });
}

function snapshot(candidateSession, sourceDraftSessionId) {
  return Object.freeze({
    kind: "rebase-candidate",
    draftSessionId: candidateSession.id,
    novelId,
    ownerConversationId: candidateSession.ownerConversationId,
    baseRevision: candidateSession.baseRevision,
    sourceDraftSessionId,
  });
}

function sequence(operationCount) {
  return Object.freeze({
    operationCount,
    lastOperationSequence: operationCount,
    operations: Object.freeze(
      Array.from({ length: operationCount }, (_, index) => ({ sequence: index + 1 })),
    ),
  });
}

console.log("novel rebase recovery smoke passed");
