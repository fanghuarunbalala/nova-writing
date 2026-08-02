import assert from "node:assert/strict";
import {
  NOVEL_DRAFT_SESSION_STATUS,
  NovelApprovalCommitOrchestrator,
  captureNovelDraftSession,
  captureNovelDraftSessionId,
  captureNovelId,
  captureNovelRevision,
  captureNovelTimestamp,
  createNovelApprovalRequest,
} from "../dist/index.js";

const session = captureNovelDraftSession({
  id: captureNovelDraftSessionId("draft-approval-orchestrator"),
  novelId: captureNovelId("novel-approval-orchestrator"),
  ownerConversationId: "conversation-approval-orchestrator",
  baseRevision: captureNovelRevision("revision-approval-orchestrator"),
  status: NOVEL_DRAFT_SESSION_STATUS.awaitingApproval,
  createdAt: captureNovelTimestamp("2026-08-02T17:00:00.000Z"),
  updatedAt: captureNovelTimestamp("2026-08-02T17:00:00.000Z"),
});

function changeSet(digestCharacter) {
  return Object.freeze({
    novelId: session.novelId,
    draftSessionId: session.id,
    baseRevision: session.baseRevision,
    digest: `sha256:${digestCharacter.repeat(64)}`,
    operationCount: 1,
    operations: Object.freeze([
      Object.freeze({
        operation: Object.freeze({
          operationId: `operation-orchestrator-${digestCharacter}`,
        }),
      }),
    ]),
  });
}

function resolution(value, decision) {
  return Object.freeze({
    request: createNovelApprovalRequest(
      value,
      session.ownerConversationId,
      captureNovelTimestamp("2026-08-02T17:01:00.000Z"),
    ),
    decision,
    inputEventId: `decision-orchestrator-${decision}`,
    resolvedAt: "2026-08-02T17:02:00.000Z",
  });
}

function orchestrator({ builds, approval, timeline }) {
  let buildIndex = 0;
  return new NovelApprovalCommitOrchestrator({
    changeSets: {
      async build() {
        timeline.push(`build-${buildIndex + 1}`);
        return builds[Math.min(buildIndex++, builds.length - 1)];
      },
    },
    approvals: {
      async request(value) {
        timeline.push("request");
        return approval(value);
      },
    },
    commits: {
      async commit() {
        timeline.push("commit");
        return Object.freeze({
          status: "committed",
          commit: Object.freeze({
            commitId: "commit-orchestrator",
            resultRevision: "revision-orchestrator-result",
          }),
        });
      },
    },
    clock: {
      now: () => captureNovelTimestamp("2026-08-02T17:01:00.000Z"),
    },
  });
}

const approvedSet = changeSet("a");
const approvedTimeline = [];
let releaseApproval;
const approved = orchestrator({
  builds: [approvedSet, approvedSet],
  timeline: approvedTimeline,
  approval: (value) =>
    new Promise((resolve) => {
      releaseApproval = () => resolve(resolution(value, "approved"));
    }),
});
const pendingCommit = approved.commit(session);
await Promise.resolve();
await Promise.resolve();
assert.deepEqual(approvedTimeline, ["build-1", "request"]);
releaseApproval();
assert.equal((await pendingCommit).status, "committed");
assert.deepEqual(approvedTimeline, ["build-1", "request", "build-2", "commit"]);

for (const decision of ["rejected", "stale"]) {
  const timeline = [];
  const value = changeSet(decision === "rejected" ? "b" : "c");
  const result = await orchestrator({
    builds: [value],
    timeline,
    approval: async () => resolution(value, decision),
  }).commit(session);
  assert.equal(result.status, decision);
  assert.deepEqual(timeline, ["build-1", "request"]);
}

const changedTimeline = [];
const requested = changeSet("d");
const changed = changeSet("e");
const changedResult = await orchestrator({
  builds: [requested, changed],
  timeline: changedTimeline,
  approval: async () => resolution(requested, "approved"),
}).commit(session);
assert.equal(changedResult.status, "stale-after-approval");
assert.deepEqual(changedTimeline, ["build-1", "request", "build-2"]);

console.log("novel approval commit orchestrator smoke passed");
