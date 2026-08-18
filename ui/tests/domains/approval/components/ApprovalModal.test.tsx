/**
 * ApprovalModal 单测（单栏弹窗：详情 + 头部导航/全部批准 + 稍后处理）：
 * 会话化过滤、组间导航切换、批量批准、决策回传（api.approvals.resolve）、
 * 实体内容解析与 stale 提示、已处理横幅、稍后处理收起。
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ApprovalQueueItem } from "@novel/core";
import { ApprovalStore } from "../../../../src/domains/approval/ApprovalStore.js";
import { ApprovalModalStore } from "../../../../src/domains/approval/ApprovalModalStore.js";
import { ApprovalModal } from "../../../../src/domains/approval/components/ApprovalModal.js";
import type {
  ApprovalEntityResolver,
  ResolvedEntityContent,
} from "../../../../src/domains/approval/approvalEntityResolver.js";

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
    toolCalls: [
      {
        toolCallId: "t1",
        toolName: opts.toolName ?? "NovelCharacterWrite",
        args: opts.args ?? JSON.stringify({ values: [{ name: "林夏" }] }),
      },
    ],
    decisioner: "ui",
    status: opts.status ?? "pending",
    requestedAt: opts.requestedAt ?? "2026-08-05T09:00:00.000Z",
  };
}

/** 用给定条目构造已拉取完毕的 store（resolve 记录调用供断言） */
async function makeStore(approvals: readonly ApprovalQueueItem[]) {
  const resolve = vi.fn(async () => true);
  const list = vi.fn(async () => approvals);
  const store = new ApprovalStore({
    api: { approvals: { list, resolve } } as never,
  });
  await store.refresh();
  return { store, resolve };
}

/** 以打开态渲染弹窗（radix Portal 挂 document.body），返回 modalStore 供断言 */
function renderModal(
  store: ApprovalStore,
  opts: { conversationId?: string; resolveEntity?: ApprovalEntityResolver } = {},
): ApprovalModalStore {
  const modalStore = new ApprovalModalStore();
  modalStore.summon();
  render(
    <ApprovalModal
      store={store}
      modalStore={modalStore}
      conversationId={opts.conversationId}
      resolveEntity={opts.resolveEntity}
    />,
  );
  return modalStore;
}

describe("ApprovalModal", () => {
  it("filters the list to the given conversation (会话化)", async () => {
    const { store } = await makeStore([
      item({ conversationId: "conv-a", requestId: "r1", args: JSON.stringify({ values: [{ name: "林夏" }] }) }),
      item({ conversationId: "conv-b", requestId: "r2", args: JSON.stringify({ values: [{ name: "苏眉" }] }) }),
    ]);
    renderModal(store, { conversationId: "conv-a" });
    // 只渲染当前会话的组；详情默认选中该组（标题出现在详情）。
    expect(screen.getAllByText("林夏").length).toBeGreaterThan(0);
    expect(screen.queryByText("苏眉")).not.toBeInTheDocument();
  });

  it("shows empty state when the conversation has no approvals", async () => {
    const { store } = await makeStore([item({ conversationId: "conv-b", requestId: "r1" })]);
    renderModal(store, { conversationId: "conv-a" });
    expect(screen.getAllByText("暂无审批请求").length).toBeGreaterThan(0);
  });

  it("shows Chinese tool label, two-section detail and decision buttons for the selected group", async () => {
    const { store } = await makeStore([item({ conversationId: "conv-a", requestId: "r1" })]);
    renderModal(store, { conversationId: "conv-a" });
    // 工具名中文化（identity meta + 详情色带）；两段式（add 空态 + 写入内容）。
    expect(screen.getAllByText("角色写入").length).toBeGreaterThan(0);
    expect(screen.getAllByText("+").length).toBeGreaterThan(0);
    expect(screen.getByText("当前内容")).toBeInTheDocument();
    expect(screen.getByText("无既有数据 · 此操作为新建")).toBeInTheDocument();
    expect(screen.getByText("写入内容")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "批准" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "拒绝" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "请求修改" })).toBeInTheDocument();
  });

  it("switches the detail via prev/next navigation when multiple groups exist", async () => {
    const { store } = await makeStore([
      item({ conversationId: "conv-a", requestId: "r1", args: JSON.stringify({ values: [{ name: "林夏" }] }) }),
      item({
        conversationId: "conv-a",
        requestId: "r2",
        requestedAt: "2026-08-05T09:30:00.000Z",
        args: JSON.stringify({ values: [{ name: "苏眉" }] }),
      }),
    ]);
    renderModal(store, { conversationId: "conv-a" });
    // 默认选中最新待审组（苏眉）；导航出现且位置指示 2/2。
    expect(screen.getAllByText("苏眉").length).toBeGreaterThan(0);
    expect(screen.getByText("1/2")).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "上一项" }));
    // 切到第一组（林夏），详情不再显示苏眉。
    expect(screen.getAllByText("林夏").length).toBeGreaterThan(0);
    expect(screen.queryByText("苏眉")).not.toBeInTheDocument();
    expect(screen.getByText("2/2")).toBeInTheDocument();
    // 循环导航：在末项点下一项回到首项。
    await user.click(screen.getByRole("button", { name: "下一项" }));
    expect(screen.getAllByText("苏眉").length).toBeGreaterThan(0);
  });

  it("decides a pending group inline (approve) via api.approvals.resolve", async () => {
    const { store, resolve } = await makeStore([item({ conversationId: "conv-a", requestId: "r1" })]);
    renderModal(store, { conversationId: "conv-a" });
    await userEvent.setup().click(screen.getByRole("button", { name: "批准" }));
    await waitFor(() =>
      expect(resolve).toHaveBeenCalledWith("r1", expect.objectContaining({ kind: "approve" })),
    );
  });

  it("approves all pending groups in one batch (全部批准)", async () => {
    const { store, resolve } = await makeStore([
      item({ conversationId: "conv-a", requestId: "r1" }),
      item({ conversationId: "conv-a", requestId: "r2", requestedAt: "2026-08-05T09:30:00.000Z" }),
    ]);
    renderModal(store, { conversationId: "conv-a" });
    await userEvent.setup().click(screen.getByRole("button", { name: /全部批准（2）/ }));
    await waitFor(() => {
      expect(resolve).toHaveBeenCalledWith("r1", expect.objectContaining({ kind: "approve" }));
      expect(resolve).toHaveBeenCalledWith("r2", expect.objectContaining({ kind: "approve" }));
    });
  });

  it("minimizes on 稍后处理 (modal store closes, selection kept)", async () => {
    const { store } = await makeStore([item({ conversationId: "conv-a", requestId: "r1" })]);
    const modalStore = renderModal(store, { conversationId: "conv-a" });
    // 精确匹配头部按钮（关闭钮 aria-label 含「稍后处理」字样，避免双命中）
    await userEvent.setup().click(screen.getByRole("button", { name: "稍后处理" }));
    expect(modalStore.getSnapshot().open).toBe(false);
    expect(modalStore.getSnapshot().selectedKey).toBe("conv-a:r1");
  });

  it("renders resolved entity content and stale banner for edit approvals", async () => {
    const { store } = await makeStore([
      item({
        conversationId: "conv-a",
        requestId: "r2",
        toolName: "NovelCharacterEdit",
        args: JSON.stringify({
          values: [{ id: "c-1", baseRevision: 1, value: { summary: "新简介" } }],
        }),
      }),
    ]);
    const staleResolver = vi.fn(async (): Promise<ResolvedEntityContent> => ({
      kind: "character",
      id: "c-1",
      name: "林夏",
      op: "edit",
      fields: [
        { field: "summary", label: "简介", old: "旧简介", new: "新简介", state: "edit" },
      ],
      stale: true,
    }));
    const modalStore = new ApprovalModalStore();
    modalStore.summon();
    render(
      <ApprovalModal
        store={store}
        modalStore={modalStore}
        conversationId="conv-a"
        resolveEntity={staleResolver}
      />,
    );
    expect((await screen.findAllByText("林夏")).length).toBeGreaterThan(0);
    expect(await screen.findByText(/版本已过期/)).toBeInTheDocument();
    expect(screen.getByText("当前内容 · 将被覆盖")).toBeInTheDocument();
  });

  it("shows processed banner and no decision buttons for a resolved approval", async () => {
    const { store } = await makeStore([
      item({ conversationId: "conv-a", requestId: "r8", status: "approved" }),
    ]);
    renderModal(store, { conversationId: "conv-a" });
    expect(screen.getByText(/已处理/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "批准" })).not.toBeInTheDocument();
  });
});
