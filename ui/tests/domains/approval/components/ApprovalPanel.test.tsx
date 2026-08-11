/**
 * ApprovalPanel 单测：详情区展示中文参数行、op 色块、无 diff 区、去重待批准、
 * 删除/编辑目标实体内容解析与改动项/失效提示。
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApprovalStore } from "../../../../src/domains/approval/ApprovalStore.js";
import { ApprovalPanel } from "../../../../src/domains/approval/components/ApprovalPanel.js";
import { FrontendPlatformProvider } from "../../../../src/platform/FrontendPlatformContext.js";

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

  it("renders resolved entity content for delete instead of raw values", async () => {
    const store = new ApprovalStore();
    store.setApprovals([
      {
        conversationId: "C-1",
        conversationStatus: "active",
        approvalRequestId: "AR-2",
        turnId: "T-2",
        toolName: "NovelDelete",
        title: "删除角色",
        argumentDigest: DIGEST,
        status: "pending",
        requestedAt: "2026-08-05T09:02:00.000Z",
        arguments: {
          baseRevision: "rev-1",
          cascade: false,
          values: [{ kind: "character", id: "c-1" }],
        },
      },
    ]);
    const resolveEntity = vi.fn(async () => ({
      kind: "character",
      id: "c-1",
      name: "林夏",
      op: "delete",
      fields: [
        { field: "name", label: "名称", old: "林夏", state: "delete" },
        { field: "aliases", label: "别名", old: "夏、夏夏", state: "delete" },
      ],
    }));
    render(
      <ApprovalPanel
        store={store}
        resolveEntity={resolveEntity}
        sourceRevision="rev-1"
      />,
    );
    expect((await screen.findAllByText("林夏")).length).toBeGreaterThan(0);
    expect(screen.getByText("名称")).toBeInTheDocument();
    // 原始参数未展示。
    expect(screen.queryByText("级联删除")).not.toBeInTheDocument();
  });

  it("renders old→new changes for edit approvals", async () => {
    const store = new ApprovalStore();
    store.setApprovals([
      {
        conversationId: "C-1",
        conversationStatus: "active",
        approvalRequestId: "AR-3",
        turnId: "T-3",
        toolName: "NovelCharacterEdit",
        title: "编辑角色",
        argumentDigest: DIGEST,
        status: "pending",
        requestedAt: "2026-08-05T09:03:00.000Z",
        arguments: {
          baseRevision: "rev-1",
          values: [{ id: "c-1", value: { summary: "新简介" } }],
        },
      },
    ]);
    const resolveEntity = vi.fn(async () => ({
      kind: "character",
      id: "c-1",
      name: "林夏",
      op: "edit",
      fields: [
        { field: "summary", label: "简介", old: "旧简介", new: "新简介", state: "edit" },
      ],
    }));
    render(
      <ApprovalPanel
        store={store}
        resolveEntity={resolveEntity}
        sourceRevision="rev-1"
      />,
    );
    // 无「改动项」标题，红旧/绿新两行。
    expect((await screen.findAllByText("旧简介")).length).toBeGreaterThan(0);
    expect(screen.getByText("新简介")).toBeInTheDocument();
    expect(screen.queryByText("改动项")).not.toBeInTheDocument();
  });

  it("shows stale banner when revision differs and hides when equal", async () => {
    const store = new ApprovalStore();
    store.setApprovals([
      {
        conversationId: "C-1",
        conversationStatus: "active",
        approvalRequestId: "AR-4",
        turnId: "T-4",
        toolName: "NovelDelete",
        title: "删除角色",
        argumentDigest: DIGEST,
        status: "pending",
        requestedAt: "2026-08-05T09:04:00.000Z",
        arguments: {
          baseRevision: "rev-1",
          values: [{ kind: "character", id: "c-1" }],
        },
      },
    ]);
    const resolveEntity = vi.fn(async () => ({
      kind: "character",
      id: "c-1",
      name: "林夏",
      op: "delete",
      fields: [],
    }));
    const { rerender } = render(
      <ApprovalPanel
        store={store}
        resolveEntity={resolveEntity}
        sourceRevision="rev-2"
      />,
    );
    expect(await screen.findByText(/版本已过期/)).toBeInTheDocument();
    rerender(
      <ApprovalPanel
        store={store}
        resolveEntity={resolveEntity}
        sourceRevision="rev-1"
      />,
    );
    await waitFor(() =>
      expect(screen.queryByText(/版本已过期/)).not.toBeInTheDocument(),
    );
  });

  it("falls back to raw params when resolution fails", async () => {
    const store = new ApprovalStore();
    store.setApprovals([
      {
        conversationId: "C-1",
        conversationStatus: "active",
        approvalRequestId: "AR-5",
        turnId: "T-5",
        toolName: "NovelDelete",
        title: "删除角色",
        argumentDigest: DIGEST,
        status: "pending",
        requestedAt: "2026-08-05T09:05:00.000Z",
        arguments: {
          baseRevision: "rev-1",
          cascade: false,
          values: [{ kind: "character", id: "c-1" }],
        },
      },
    ]);
    const resolveEntity = vi.fn(async () => undefined);
    render(
      <ApprovalPanel
        store={store}
        resolveEntity={resolveEntity}
        sourceRevision="rev-1"
      />,
    );
    // 解析失败回退原始参数（级联删除 / 类型）。
    expect(await screen.findByText("级联删除")).toBeInTheDocument();
    expect(screen.getByText("类型")).toBeInTheDocument();
  });

  it("resolves add approval and shows green content", async () => {
    const resolveEntity = vi.fn(async () => ({
      kind: "character",
      id: "C-1",
      name: "林夏",
      op: "add",
      fields: [{ field: "name", label: "名称", new: "林夏", state: "add" }],
    }));
    render(
      <ApprovalPanel
        store={makeStore()}
        resolveEntity={resolveEntity}
        sourceRevision="rev-1"
      />,
    );
    expect((await screen.findAllByText("林夏")).length).toBeGreaterThan(0);
    expect(resolveEntity).toHaveBeenCalled();
  });

  it("renders one resolved block per delete target", async () => {
    const store = new ApprovalStore();
    store.setApprovals([
      {
        conversationId: "C-1",
        conversationStatus: "active",
        approvalRequestId: "AR-6",
        turnId: "T-6",
        toolName: "NovelDelete",
        title: "批量删除",
        argumentDigest: DIGEST,
        status: "pending",
        requestedAt: "2026-08-05T09:06:00.000Z",
        arguments: {
          baseRevision: "rev-1",
          values: [
            { kind: "character", id: "c-1" },
            { kind: "location", id: "l-1" },
          ],
        },
      },
    ]);
    const resolveEntity = vi.fn(async (target) =>
      target.id === "c-1"
        ? {
            kind: "character",
            id: "c-1",
            name: "林夏",
            op: "delete",
            fields: [{ field: "name", label: "名称", old: "林夏", state: "delete" }],
          }
        : {
            kind: "location",
            id: "l-1",
            name: "旧船坞",
            op: "delete",
            fields: [{ field: "name", label: "名称", old: "旧船坞", state: "delete" }],
          },
    );
    render(
      <ApprovalPanel
        store={store}
        resolveEntity={resolveEntity}
        sourceRevision="rev-1"
      />,
    );
    expect((await screen.findAllByText("林夏")).length).toBeGreaterThan(0);
    expect((await screen.findAllByText("旧船坞")).length).toBeGreaterThan(0);
  });

  it("does not resolve or flag stale for a resolved approval", async () => {
    const store = new ApprovalStore();
    store.setApprovals([
      {
        conversationId: "C-1",
        conversationStatus: "active",
        approvalRequestId: "AR-9",
        turnId: "T-9",
        toolName: "NovelCharacterEdit",
        title: "编辑角色",
        argumentDigest: DIGEST,
        status: "approved",
        requestedAt: "2026-08-05T09:00:00.000Z",
        arguments: {
          baseRevision: "rev-1",
          values: [{ id: "c-1", value: { summary: "新简介" } }],
        },
      },
    ]);
    const resolveEntity = vi.fn(async () => ({
      kind: "character",
      id: "c-1",
      name: "林夏",
      op: "edit",
      fields: [{ field: "summary", label: "简介", old: "旧简介", new: "新简介", state: "edit" }],
    }));
    render(
      <ApprovalPanel
        store={store}
        resolveEntity={resolveEntity}
        sourceRevision="rev-2"
      />,
    );
    // 已决审批不解析、不显示失效提示，原始参数作参考。
    expect(resolveEntity).not.toHaveBeenCalled();
    expect(screen.queryByText(/版本已过期/)).not.toBeInTheDocument();
    expect(screen.getByText("审批参数")).toBeInTheDocument();
    expect(screen.getByText("新简介")).toBeInTheDocument();
  });

  it("renders the design draft content for ExitComposeMode approval (CCB-style)", async () => {
    const store = new ApprovalStore();
    store.setApprovals([
      {
        conversationId: "C-1",
        conversationStatus: "active",
        approvalRequestId: "AR-10",
        turnId: "T-10",
        toolName: "ExitComposeMode",
        title: "提交设计草稿",
        argumentDigest: DIGEST,
        status: "pending",
        requestedAt: "2026-08-05T09:00:00.000Z",
        description:
          "请确认设计草稿内容后批准；批准后按草稿内容落库。\n设计文件：.novel/design/c-1.md",
        arguments: { summary: "第三章正文草稿已完成" },
      },
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
        <ApprovalPanel store={store} />
      </FrontendPlatformProvider>,
    );
    // 设计文件路径 + 提交说明 + 草稿内容（经 designFile 端口读取渲染）。
    expect(screen.getByText(/设计文件：\.novel\/design\/c-1\.md/)).toBeInTheDocument();
    expect(screen.getByText("提交说明")).toBeInTheDocument();
    expect(screen.getByText("第三章正文草稿已完成")).toBeInTheDocument();
    expect(await screen.findByText("正文草稿内容")).toBeInTheDocument();
    // 不走参数区与误导性「旧版本审批」空态。
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
