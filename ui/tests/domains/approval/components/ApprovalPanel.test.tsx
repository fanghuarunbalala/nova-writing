/**
 * ApprovalPanel 单测（现行 API：ApprovalStore({api}) + ApprovalQueueItem）：
 * 目录按 conversationId 会话化过滤、平铺审批组（无跨会话分组/跳转）、
 * 详情区中文参数与 op 色块、待审决策按钮、实体内容解析与 stale 提示、
 * ExitComposeMode 审批的 design 草稿确认体（CCB 式，不走参数区）。
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ApprovalQueueItem } from "@novel/core";
import { ApprovalStore } from "../../../../src/domains/approval/ApprovalStore.js";
import { ApprovalPanel } from "../../../../src/domains/approval/components/ApprovalPanel.js";
import type { ResolvedEntityContent } from "../../../../src/domains/approval/approvalEntityResolver.js";
import { FrontendPlatformProvider } from "../../../../src/platform/FrontendPlatformContext.js";

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
    // 无旧版 diff 区与执行结果区（方案 E 已移除）。
    expect(screen.queryByText("大纲变更")).not.toBeInTheDocument();
    expect(screen.queryByText("正文变更")).not.toBeInTheDocument();
    expect(screen.queryByText("实体变更")).not.toBeInTheDocument();
    expect(screen.queryByText("执行结果")).not.toBeInTheDocument();
  });

  it("shows the pending pill without an item count for a single request", async () => {
    const store = await makeStore([
      item({ conversationId: "conv-a", requestId: "r1" }),
    ]);
    render(<ApprovalPanel store={store} conversationId="conv-a" drawerOpen />);
    // 目录行 pill 保留（待批准），单请求无「N 项」计数。
    expect(screen.getAllByText("待批准").length).toBeGreaterThan(0);
    expect(screen.queryByText(/项待批准/)).not.toBeInTheDocument();
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

  it("renders resolved entity content for delete instead of raw values", async () => {
    const store = await makeStore([
      item({
        conversationId: "conv-a",
        requestId: "r2b",
        toolName: "NovelDelete",
        args: JSON.stringify({
          cascade: false,
          values: [{ kind: "character", id: "c-1" }],
        }),
      }),
    ]);
    const resolveEntity = vi.fn(async (): Promise<ResolvedEntityContent> => ({
      kind: "character",
      id: "c-1",
      name: "林夏",
      op: "delete",
      fields: [
        { field: "name", label: "名称", old: "林夏", state: "delete" },
        { field: "aliases", label: "别名", old: "夏、夏夏", state: "delete" },
      ],
      stale: false,
    }));
    render(
      <ApprovalPanel store={store} conversationId="conv-a" drawerOpen resolveEntity={resolveEntity} />,
    );
    expect(await screen.findByText("夏、夏夏")).toBeInTheDocument();
    expect(screen.getByText("名称")).toBeInTheDocument();
    // 原始参数未展示。
    expect(screen.queryByText("级联删除")).not.toBeInTheDocument();
  });

  it("renders old→new changes for edit approvals", async () => {
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
    const resolveEntity = vi.fn(async (): Promise<ResolvedEntityContent> => ({
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
    // 红旧/绿新两行，无「改动项」标题。
    expect((await screen.findAllByText("旧简介")).length).toBeGreaterThan(0);
    expect(screen.getByText("新简介")).toBeInTheDocument();
    expect(screen.queryByText("改动项")).not.toBeInTheDocument();
  });

  it("shows stale banner when the resolver reports a stale target and hides when fresh", async () => {
    const store = await makeStore([
      item({
        conversationId: "conv-a",
        requestId: "r4",
        toolName: "CharacterEdit",
        args: JSON.stringify({
          values: [{ characterId: "c-1", baseRevision: 1, patch: { summary: "新简介" } }],
        }),
      }),
    ]);
    const staleResolver = vi.fn(async () => ({
      kind: "character",
      id: "c-1",
      name: "林夏",
      op: "edit",
      fields: [{ field: "summary", label: "简介", old: "旧简介", new: "新简介", state: "edit" }],
      stale: true,
    }));
    const freshResolver = vi.fn(async () => ({
      kind: "character",
      id: "c-1",
      name: "林夏",
      op: "edit",
      fields: [{ field: "summary", label: "简介", old: "旧简介", new: "新简介", state: "edit" }],
      stale: false,
    }));
    const { rerender } = render(
      <ApprovalPanel store={store} conversationId="conv-a" drawerOpen resolveEntity={staleResolver} />,
    );
    expect(await screen.findByText(/版本已过期/)).toBeInTheDocument();
    rerender(
      <ApprovalPanel store={store} conversationId="conv-a" drawerOpen resolveEntity={freshResolver} />,
    );
    await waitFor(() =>
      expect(screen.queryByText(/版本已过期/)).not.toBeInTheDocument(),
    );
  });

  it("falls back to raw params when resolution fails", async () => {
    const store = await makeStore([
      item({
        conversationId: "conv-a",
        requestId: "r5",
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

  it("resolves add approval and shows green content", async () => {
    const store = await makeStore([
      item({ conversationId: "conv-a", requestId: "r6" }),
    ]);
    const resolveEntity = vi.fn(async (): Promise<ResolvedEntityContent> => ({
      kind: "character",
      id: "add-character-0",
      name: "林夏",
      op: "add",
      fields: [{ field: "name", label: "名称", new: "林夏", state: "add" }],
      stale: false,
    }));
    render(
      <ApprovalPanel store={store} conversationId="conv-a" drawerOpen resolveEntity={resolveEntity} />,
    );
    expect((await screen.findAllByText("林夏")).length).toBeGreaterThan(0);
    expect(resolveEntity).toHaveBeenCalled();
  });

  it("renders one resolved block per delete target", async () => {
    const store = await makeStore([
      item({
        conversationId: "conv-a",
        requestId: "r7",
        toolName: "NovelDelete",
        args: JSON.stringify({
          values: [
            { kind: "character", id: "c-1" },
            { kind: "location", id: "l-1" },
          ],
        }),
      }),
    ]);
    const resolveEntity = vi.fn(
      async (target: { id: string }): Promise<ResolvedEntityContent> =>
        target.id === "c-1"
          ? {
              kind: "character",
              id: "c-1",
              name: "林夏",
              op: "delete",
              fields: [{ field: "name", label: "名称", old: "林夏", state: "delete" }],
              stale: false,
            }
          : {
              kind: "location",
              id: "l-1",
              name: "旧船坞",
              op: "delete",
              fields: [{ field: "name", label: "名称", old: "旧船坞", state: "delete" }],
              stale: false,
            },
    );
    render(
      <ApprovalPanel store={store} conversationId="conv-a" drawerOpen resolveEntity={resolveEntity} />,
    );
    expect((await screen.findAllByText("林夏")).length).toBeGreaterThan(0);
    expect((await screen.findAllByText("旧船坞")).length).toBeGreaterThan(0);
  });

  it("shows processed banner and no decision buttons for a resolved approval", async () => {
    const store = await makeStore([
      item({ conversationId: "conv-a", requestId: "r8", status: "approved" }),
    ]);
    render(<ApprovalPanel store={store} conversationId="conv-a" drawerOpen />);
    expect(screen.getByText(/已处理/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "批准" })).not.toBeInTheDocument();
  });

  it("does not resolve or flag stale for a resolved approval", async () => {
    const store = await makeStore([
      item({
        conversationId: "conv-a",
        requestId: "r9",
        toolName: "CharacterEdit",
        status: "approved",
        args: JSON.stringify({
          values: [{ characterId: "c-1", baseRevision: 1, patch: { summary: "新简介" } }],
        }),
      }),
    ]);
    const resolveEntity = vi.fn();
    render(
      <ApprovalPanel store={store} conversationId="conv-a" drawerOpen resolveEntity={resolveEntity} />,
    );
    // 已决审批不解析、不显示失效提示，原始参数作参考。
    expect(resolveEntity).not.toHaveBeenCalled();
    expect(screen.queryByText(/版本已过期/)).not.toBeInTheDocument();
    expect(screen.getByText("审批参数")).toBeInTheDocument();
    expect(screen.getByText("新简介")).toBeInTheDocument();
  });

  it("renders the design draft content for ExitComposeMode approval (CCB-style)", async () => {
    const store = await makeStore([
      item({
        conversationId: "C-1",
        requestId: "r10",
        toolName: "ExitComposeMode",
        args: JSON.stringify({ summary: "第三章正文草稿已完成" }),
      }),
    ]);
    const designFile = {
      read: vi.fn(async () => "# 第三章\n\n正文草稿内容"),
      write: vi.fn(async () => {}),
    };
    render(
      <FrontendPlatformProvider
        platform={{
          capabilities: {
            fileSelection: false,
            clipboardRead: false,
            clipboardWrite: false,
            notifications: false,
          },
          files: { selectFiles: vi.fn(async () => []) },
          clipboard: { readText: vi.fn(async () => ""), writeText: vi.fn(async () => {}) },
          notifications: { show: vi.fn(async () => {}) },
          designFile,
        }}
      >
        <ApprovalPanel store={store} conversationId="C-1" drawerOpen />
      </FrontendPlatformProvider>,
    );
    // 提交说明 + 草稿内容（经 designFile 端口读取渲染），不走参数区与「旧版本审批」空态。
    expect(screen.getByText("提交说明")).toBeInTheDocument();
    expect(screen.getByText("第三章正文草稿已完成")).toBeInTheDocument();
    expect(await screen.findByText("正文草稿内容")).toBeInTheDocument();
    expect(screen.queryByText("审批参数")).not.toBeInTheDocument();
    expect(screen.queryByText(/旧版本审批/)).not.toBeInTheDocument();

    // 审批卡内直接编辑：编辑 → 改草稿 → 保存写回 design 文件。
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "编辑" }));
    const textarea = screen.getByRole("textbox");
    await user.clear(textarea);
    await user.type(textarea, "# 第三章（修订）\n\n修订后的正文");
    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(designFile.write).toHaveBeenCalledWith(
        "C-1",
        "# 第三章（修订）\n\n修订后的正文",
      ),
    );
    expect(screen.getByText("修订后的正文")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});
