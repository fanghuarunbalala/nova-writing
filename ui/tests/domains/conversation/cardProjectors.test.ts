/**
 * 卡片投影器单测。
 * Unit tests for conversation card projectors.
 */
import { describe, expect, it } from "vitest";
import type { PersistedOutputEventSnapshot } from "@novel/core";
import {
  createDefaultConversationCardProjectorRegistry,
  novelApprovalRequestedProjector,
} from "../../../src/domains/conversation/cards/projectors/index.js";

function approvalEvent(
  overrides: Partial<PersistedOutputEventSnapshot> = {},
): PersistedOutputEventSnapshot {
  return {
    id: "evt_approval_1",
    conversationId: "c1",
    eventType: "novel.approval.requested",
    schemaVersion: 1,
    timestamp: "2026-08-05T09:00:02.000Z",
    payload: {
      requestVersion: 1,
      approvalRequestId: "AR-1",
      novelId: "novel_1",
      draftSessionId: "DS-1",
      baseRevision: "r041",
      changeSetDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      operationIds: ["op-1", "op-2"],
    },
    direction: "output",
    sequence: 3,
    recordedAt: "2026-08-05T09:00:02.100Z",
    ...overrides,
  };
}

describe("novelApprovalRequestedProjector", () => {
  it("projects an approval card from the event payload", () => {
    const card = novelApprovalRequestedProjector(approvalEvent());
    expect(card).toMatchObject({
      cardId: "AR-1",
      kind: "approval",
      title: "变更提议",
      status: "pending",
    });
    expect(card?.summary).toContain("base r041");
    expect(card?.summary).toContain("2 个操作");
  });

  it("ignores unrelated event types", () => {
    expect(
      novelApprovalRequestedProjector(
        approvalEvent({ eventType: "agent.todo.updated", payload: {} }),
      ),
    ).toBeUndefined();
  });

  it("skips events without a valid approval id", () => {
    expect(
      novelApprovalRequestedProjector(
        approvalEvent({
          payload: { approvalRequestId: "", baseRevision: "r041", operationIds: [] },
        }),
      ),
    ).toBeUndefined();
  });
});

describe("createDefaultConversationCardProjectorRegistry", () => {
  it("projects approval events through the registry", () => {
    const registry = createDefaultConversationCardProjectorRegistry();
    const card = registry.project(approvalEvent());
    expect(card?.kind).toBe("approval");
    expect(card?.cardId).toBe("AR-1");
  });
});
