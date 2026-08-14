/**
 * ApprovalPanel 单测（现行 API：ApprovalStore({api}) + ApprovalQueueItem）：
 * 目录按 conversationId 会话化过滤、平铺审批组（无跨会话分组/跳转）、
 * 详情区中文参数与 op 色块、待审决策按钮、实体内容解析与 stale 提示。
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ApprovalQueueItem } from "@novel/core";
import { ApprovalStore } from "../../../../src/domains/approval/ApprovalStore.js";
import { ApprovalPanel } from "../../../../src/domains/approval/components/ApprovalPanel.js";

/** 审批队列条目夹具（args 为 JSON 字符串，与 CMS wait 队列一致） */
function item(opts: {
  conversationId: string;
  requestId: string;
  toolName?: string;
  args?: string;
  status?: ApprovalQueueItem["status"];
  requestedAt?: string;
}): ApprovalQueueItem {
  return {
    conversationId: opts.conversationId,
    requestId: opts.requestId,
    toolName: opts.toolName ?? "CharacterWrite",
    args: opts.args ?? JSON.stringify({ values: [{ name: "林夏" }] }),
    decisioner: "ui",
    status: opts.status ?? "pending",
    requestedAt: opts.requestedAt ?? "2026-08-05T09:00:00.000Z",
  };
}

/** 用给定条目构造已拉取完毕的 store */
async function makeStore(approvals: readonly ApprovalQueueItem[]): Promise<ApprovalStore> {
  const store = new ApprovalStore({
    api: {
      approvals: {
        list: vi.fn(async () => approvals),
        resolve: vi.fn(async () => true),
      },
    } as never,
  });
  await store.refresh();
  return store;
}

describe("ApprovalPanel", () => {
  it("filters the directory to the given conversation (no cross-conversation groups)", async () => {
    const store = await makeStore([
      item({ conversationId: "conv-a", requestId: "r1", args: JSON.stringify({ values: [{ name: "林夏" }] }) }),
      item({ conversationId: "conv-b", requestId: "r2", args: JSON.stringify({ values: [{ name: "苏眉" }] }) }),
    ]);
    render(<ApprovalPanel store={store} conversationId="conv-a" drawerOpen />);
    // 目录只有当前会话的条目；跨会话分组与「跳转」按钮已移除。
    expect(screen.getAllByText("林夏").length).toBeGreaterThan(0);
    expect(screen.queryByText("苏眉")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "跳转" })).not.toBeInTheDocument();
  });

  it("shows all approvals when conversationId is omitted (host fallback)", async () => {
    const store = await makeStore([
      item({ conversationId: "conv-a", requestId: "r1", args: JSON.stringify({ values: [{ name: "林夏" }] }) }),
      item({ conversationId: "conv-b", requestId: "r2", args: JSON.stringify({ values: [{ name: "苏眉" }] }) }),
    ]);
    render(<ApprovalPanel store={store} drawerOpen />);
    expect(screen.getAllByText("林夏").length).toBeGreaterThan(0);
    expect(screen.getAllByText("苏眉").length).toBeGreaterThan(0);
  });

  it("shows empty state when the conversation has no approvals", async () => {
    const store = await makeStore([
      item({ conversationId: "conv-b", requestId: "r1" }),
    ]);
    render(<ApprovalPanel store={store} conversationId="conv-a" drawerOpen />);
    expect(screen.getByText("暂无审批请求")).toBeInTheDocument();
  });

  it("shows Chinese tool label, op chip and decision buttons for a pending group", async () => {
    const store = await makeStore([
      item({ conversationId: "conv-a", requestId: "r1" }),
    ]);
    render(<ApprovalPanel store={store} conversationId="conv-a" drawerOpen />);
    // 工具名中文化（identity meta + 详情色带）。
    expect(screen.getAllByText("角色写入").length).toBeGreaterThan(0);
    // op 色块（CharacterWrite → add）：标题 diff 符号。
    expect(screen.getAllByText("+").length).toBeGreaterThan(0);
    // 参数区（无 resolver → 平铺原始参数）。
    expect(screen.getByText("审批参数")).toBeInTheDocument();
    // 待审批 → 决策按钮可用；已处理横幅不出现。
    expect(screen.getByRole("button", { name: "批准" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "拒绝" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "请求修改" })).toBeInTheDocument();
    expect(screen.queryByText(/已处理/)).not.toBeInTheDocument();
  });

  it("renders resolved entity content for edit instead of raw values", async () => {
    const store = await makeStore([
      item({
        conversationId: "conv-a",
        requestId: "r2",
        toolName: "CharacterEdit",
        args: JSON.stringify({
          values: [{ characterId: "c-1", baseRevision: 1, patch: { summary: "新简介" } }],
        }),
      }),
    ]);
    const resolveEntity = vi.fn(async () => ({
      kind: "character",
      id: "c-1",
      name: "林夏",
      op: "edit",
      fields: [
        { field: "summary", label: "简介", old: "旧简介", new: "新简介", state: "edit" },
      ],
      stale: false,
    }));
    render(
      <ApprovalPanel store={store} conversationId="conv-a" drawerOpen resolveEntity={resolveEntity} />,
    );
    expect((await screen.findAllByText("林夏")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("简介").length).toBeGreaterThan(0);
    expect(screen.getAllByText("新简介").length).toBeGreaterThan(0);
  });

  it("shows stale banner when the resolver reports a stale target", async () => {
    const store = await makeStore([
      item({
        conversationId: "conv-a",
        requestId: "r3",
        toolName: "CharacterEdit",
        args: JSON.stringify({
          values: [{ characterId: "c-1", baseRevision: 1, patch: { summary: "新简介" } }],
        }),
      }),
    ]);
    const resolveEntity = vi.fn(async () => ({
      kind: "character",
      id: "c-1",
      name: "林夏",
      op: "edit",
      fields: [{ field: "summary", label: "简介", old: "旧简介", new: "新简介", state: "edit" }],
      stale: true,
    }));
    render(
      <ApprovalPanel store={store} conversationId="conv-a" drawerOpen resolveEntity={resolveEntity} />,
    );
    expect(await screen.findByText(/版本已过期/)).toBeInTheDocument();
  });

  it("falls back to raw params when resolution fails", async () => {
    const store = await makeStore([
      item({
        conversationId: "conv-a",
        requestId: "r4",
        toolName: "NovelDelete",
        args: JSON.stringify({
          cascade: false,
          values: [{ kind: "character", id: "c-1" }],
        }),
      }),
    ]);
    const resolveEntity = vi.fn(async () => undefined);
    render(
      <ApprovalPanel store={store} conversationId="conv-a" drawerOpen resolveEntity={resolveEntity} />,
    );
    // 解析失败 → 平铺原始参数（级联删除 / 类型）。
    expect(await screen.findByText("级联删除")).toBeInTheDocument();
    expect(screen.getByText("类型")).toBeInTheDocument();
  });

  it("shows processed banner and no decision buttons for a resolved approval", async () => {
    const store = await makeStore([
      item({ conversationId: "conv-a", requestId: "r5", status: "approved" }),
    ]);
    render(<ApprovalPanel store={store} conversationId="conv-a" drawerOpen />);
    expect(screen.getByText(/已处理/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "批准" })).not.toBeInTheDocument();
  });
});
