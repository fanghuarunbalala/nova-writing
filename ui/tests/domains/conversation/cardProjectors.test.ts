/**
 * 卡片投影器单测（工具审批请求 → approval 卡）。
 * Unit tests for the tool approval-request card projector.
 */
import { describe, expect, it } from "vitest";
import type { PersistedOutputEventSnapshot } from "@novel/core";
import {
  createDefaultConversationCardProjectorRegistry,
  toolApprovalRequestedProjector,
} from "../../../src/domains/conversation/cards/projectors/index.js";

function approvalEvent(
  overrides: Partial<PersistedOutputEventSnapshot> = {},
): PersistedOutputEventSnapshot {
  return {
    id: "evt_approval_1",
    conversationId: "c1",
    eventType: "system.tool.approval.requested",
    schemaVersion: 1,
    timestamp: "2026-08-05T09:00:02.000Z",
    payload: {
      approvalRequestId: "AR-1",
      toolCallId: "call-1",
      toolName: "NovelParagraphWrite",
      toolVersion: "1.0.0",
      argumentDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      summary: {
        title: "新增正文块 §3-01-04",
        description: "在旧船坞 7 号新增货单发现场景段落",
      },
      requestedAt: "2026-08-05T09:00:02.000Z",
      expiresAt: "2026-08-05T09:15:02.000Z",
    },
    direction: "output",
    sequence: 3,
    recordedAt: "2026-08-05T09:00:02.100Z",
    ...overrides,
  };
}

describe("toolApprovalRequestedProjector", () => {
  it("projects an approval card from the event payload", () => {
    const card = toolApprovalRequestedProjector(approvalEvent());
    expect(card).toMatchObject({
      cardId: "AR-1",
      kind: "approval",
      title: "新增正文块 §3-01-04",
      status: "pending",
    });
    expect(card?.summary).toContain("货单发现");
  });

  it("falls back to a tool-based title without summary", () => {
    const card = toolApprovalRequestedProjector(
      approvalEvent({ payload: { approvalRequestId: "AR-2", toolName: "NovelDelete" } }),
    );
    expect(card?.title).toContain("NovelDelete");
  });

  it("ignores unrelated event types", () => {
    expect(
      toolApprovalRequestedProjector(
        approvalEvent({ eventType: "novel.approval.requested", payload: {} }),
      ),
    ).toBeUndefined();
  });
});

describe("createDefaultConversationCardProjectorRegistry", () => {
  it("projects tool approval events through the registry", () => {
    const registry = createDefaultConversationCardProjectorRegistry();
    const card = registry.project(approvalEvent());
    expect(card?.kind).toBe("approval");
    expect(card?.cardId).toBe("AR-1");
  });
});
