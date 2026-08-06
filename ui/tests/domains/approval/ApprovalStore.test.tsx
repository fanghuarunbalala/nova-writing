/**
 * ApprovalStore 单测：列表派生、决策回调、选中态。
 */
import { describe, expect, it, vi } from "vitest";
import { ApprovalStore } from "../../../src/domains/approval/ApprovalStore.js";

const DIGEST = "sha256:0000000000000000000000000000000000000000000000000000000000000000";

describe("ApprovalStore", () => {
  it("derives pending count and forwards decisions with the digest", () => {
    const store = new ApprovalStore();
    store.setApprovals([
      {
        approvalRequestId: "AR-1",
        toolName: "NovelParagraphWrite",
        title: "新增段落",
        argumentDigest: DIGEST,
        status: "pending",
        requestedAt: "2026-08-05T09:00:00.000Z",
      },
      {
        approvalRequestId: "AR-2",
        toolName: "NovelOutlineEdit",
        title: "修改大纲",
        argumentDigest: DIGEST,
        status: "approved",
        requestedAt: "2026-08-05T09:01:00.000Z",
        resolvedAt: "2026-08-05T09:02:00.000Z",
      },
    ]);
    expect(store.getSnapshot().pendingCount).toBe(1);
    expect(store.getSnapshot().approvals).toHaveLength(2);

    const handler = vi.fn();
    store.setDecisionHandler(handler);
    void store.decide("AR-1", "approved");
    expect(handler).toHaveBeenCalledWith("AR-1", "approved", DIGEST);

    store.select("AR-2");
    expect(store.getSnapshot().selectedId).toBe("AR-2");
  });
});
