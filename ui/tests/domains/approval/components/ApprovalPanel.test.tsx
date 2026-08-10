/**
 * ApprovalPanel 单测：详情区展示中文参数行、op 色块、无 diff 区、去重待批准。
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
      arguments: {
        baseRevision: "rev-1",
        values: [
          { id: "C-1", name: "林夏", aliases: ["夏"], authorNotes: "航运经理" },
        ],
      },
    },
  ]);
  return store;
}

describe("ApprovalPanel", () => {
  it("shows Chinese params, op chip, and no diff sections", () => {
    render(<ApprovalPanel store={makeStore()} />);
    // 工具名中文化（identity + 目录 meta）。
    expect(screen.getAllByText("角色写入").length).toBeGreaterThan(0);
    expect(screen.getByText("审批参数")).toBeInTheDocument();
    // baseRevision 隐藏，角色字段按 name 开头、authorNotes 收尾。
    expect(screen.queryByText("基础修订版本")).not.toBeInTheDocument();
    expect(screen.getByText("名称")).toBeInTheDocument();
    expect(screen.getByText("林夏")).toBeInTheDocument();
    expect(screen.getByText("作者注记")).toBeInTheDocument();
    // op 色块（NovelCharacterWrite → 写入）：目录行小色块。
    expect(screen.getAllByText("写入").length).toBeGreaterThan(0);
    // 方案 E：diff 符号（色带 + 参数行 gutter）。
    expect(screen.getAllByText("+").length).toBeGreaterThan(0);
    // 无 diff 区与执行结果区。
    expect(screen.queryByText("大纲变更")).not.toBeInTheDocument();
    expect(screen.queryByText("正文变更")).not.toBeInTheDocument();
    expect(screen.queryByText("实体变更")).not.toBeInTheDocument();
    expect(screen.queryByText("执行结果")).not.toBeInTheDocument();
  });

  it("dedupes pending status: no status line or item count", () => {
    render(<ApprovalPanel store={makeStore()} />);
    // 右上角 identity pill 保留（待批准），但 statusLine 与「N 项待批准」计数移除。
    expect(screen.getAllByText("待批准").length).toBeGreaterThan(0);
    expect(screen.queryByText(/项待批准/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^请求 /)).not.toBeInTheDocument();
  });
});
