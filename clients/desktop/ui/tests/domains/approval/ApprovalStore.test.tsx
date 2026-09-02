/**
 * ApprovalStore 单测：列表拉取派生 pending 计数、决策提交（approve/reject/edit）、选中态。
 * 数据唯一权威是 CMS wait 队列（经 api.approvals 拉取/提交）。
 */
import { describe, expect, it, vi } from "vitest";
import type { ApprovalQueueItem, NovelApiClient } from "@novel/core";
import { ApprovalStore } from "../../../src/domains/approval/ApprovalStore.js";

function queueItem(overrides: Partial<ApprovalQueueItem> = {}): ApprovalQueueItem {
  return {
    conversationId: "C-1",
    requestId: "AR-1",
    toolCalls: [
      {
        toolCallId: "t1",
        toolName: "CharacterWrite",
        args: JSON.stringify({ values: [{ name: "林夏" }] }),
      },
    ],
    decisioner: "ui",
    status: "pending",
    requestedAt: "2026-08-05T09:00:00.000Z",
    ...overrides,
  };
}

function buildApi(items: readonly ApprovalQueueItem[]): {
  api: NovelApiClient;
  list: ReturnType<typeof vi.fn>;
  resolve: ReturnType<typeof vi.fn>;
} {
  const list = vi.fn(async () => items);
  const resolve = vi.fn(async () => true);
  const api = {
    conversations: {} as never,
    novel: {} as never,
    approvals: { list, resolve },
  } as unknown as NovelApiClient;
  return { api, list, resolve };
}

describe("ApprovalStore", () => {
  it("derives pending count and list from the wait queue", async () => {
    const { api } = buildApi([
      queueItem(),
      queueItem({ requestId: "AR-2", status: "approved" }),
    ]);
    const store = new ApprovalStore({ api });
    await store.refresh();
    expect(store.getSnapshot().approvals).toHaveLength(2);
    expect(store.getSnapshot().pendingCount).toBe(1);
  });

  it("submits decisions through api.approvals.resolve and refreshes on hit", async () => {
    const { api, resolve } = buildApi([queueItem()]);
    const store = new ApprovalStore({ api });
    await store.refresh();

    await store.decide("AR-1", "approved");
    expect(resolve).toHaveBeenCalledWith("AR-1", { kind: "approve" });

    await store.decide("AR-1", "rejected");
    expect(resolve).toHaveBeenLastCalledWith("AR-1", { kind: "reject" });

    await store.decideEdited("AR-1", "改一下");
    expect(resolve).toHaveBeenLastCalledWith("AR-1", { kind: "edit", text: "改一下" });
  });

  it("keeps stale data and selection on refresh failure", async () => {
    const { api, list } = buildApi([queueItem()]);
    list.mockRejectedValueOnce(new Error("down"));
    const store = new ApprovalStore({ api });
    store.select("AR-1");
    await store.refresh();
    expect(store.getSnapshot().approvals).toHaveLength(0);
    expect(store.getSnapshot().selectedId).toBe("AR-1");
  });
});
