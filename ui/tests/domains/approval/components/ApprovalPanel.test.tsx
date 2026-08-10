/**
 * ApprovalPanel 单测：详情区展示中文参数行、无 diff 区、工具名中文化。
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ApprovalStore } from "../../../../src/domains/approval/ApprovalStore.js";
import { ApprovalPanel } from "../../../../src/domains/approval/components/ApprovalPanel.js";

const DIGEST = "sha256:0000000000000000000000000000000000000000000000000000000000000000";

function makeStore(): ApprovalStore {
  const store = new ApprovalStore();
  store.setApprovals([
    {
      conversationId: "C-1",
      conversationStatus: "active",
      approvalRequestId: "AR-1",
      turnId: "T-1",
      toolName: "NovelCharacterWrite",
      title: "新增角色：林夏",
      argumentDigest: DIGEST,
      status: "pending",
      requestedAt: "2026-08-05T09:00:00.000Z",
      arguments: { baseRevision: "rev-1", values: [{ id: "C-1", name: "林夏" }] },
    },
  ]);
  return store;
}

describe("ApprovalPanel", () => {
  it("shows Chinese params and no diff sections", () => {
    render(<ApprovalPanel store={makeStore()} />);
    expect(screen.getAllByText("角色写入").length).toBeGreaterThan(0);
    expect(screen.getByText("审批参数")).toBeInTheDocument();
    expect(screen.getByText("基础修订版本")).toBeInTheDocument();
    expect(screen.queryByText("大纲变更")).not.toBeInTheDocument();
    expect(screen.queryByText("正文变更")).not.toBeInTheDocument();
    expect(screen.queryByText("实体变更")).not.toBeInTheDocument();
  });
});
