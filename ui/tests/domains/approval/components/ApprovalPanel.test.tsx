/**
 * ApprovalPanel 单测：详情区展示中文参数行、op diff 符号、删除/编辑目标实体内容解析、
 * 乐观锁失效提示、解析失败回退原始参数、已决审批不解析。
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { ApprovalQueueItem, NovelApiClient } from "@novel/core";
import { ApprovalStore } from "../../../../src/domains/approval/ApprovalStore.js";
import { ApprovalPanel } from "../../../../src/domains/approval/components/ApprovalPanel.js";
import type { ResolvedEntityContent } from "../../../../src/domains/approval/approvalEntityResolver.js";

function queueItem(overrides: Partial<ApprovalQueueItem> = {}): ApprovalQueueItem {
  return {
    conversationId: "C-1",
    requestId: "AR-1",
    toolName: "CharacterWrite",
    args: JSON.stringify({
      values: [{ name: "林夏", aliases: ["夏"], authorNotes: "航运经理" }],
    }),
    decisioner: "ui",
    status: "pending",
    requestedAt: "2026-08-05T09:00:00.000Z",
    ...overrides,
  };
}

async function makeStore(items: readonly ApprovalQueueItem[]): Promise<ApprovalStore> {
  const api = {
    conversations: {} as never,
    novel: {} as never,
    approvals: {
      list: vi.fn(async () => items),
      resolve: vi.fn(async () => true),
    },
  } as unknown as NovelApiClient;
  const store = new ApprovalStore({ api });
  await store.refresh();
  return store;
}

describe("ApprovalPanel", () => {
  it("shows Chinese params and op diff glyphs", async () => {
    const store = await makeStore([queueItem()]);
    render(<ApprovalPanel store={store} />);
    // 工具名中文化（identity + 参数组色带）。
    expect(screen.getAllByText("角色写入").length).toBeGreaterThan(0);
    expect(screen.getByText("审批参数")).toBeInTheDocument();
    expect(screen.getByText("名称")).toBeInTheDocument();
    // 目录行标题 + 参数值两处出现。
    expect(screen.getAllByText("林夏").length).toBeGreaterThan(0);
    expect(screen.getByText("作者注记")).toBeInTheDocument();
    // 方案 E：diff 符号（标题 + 参数行 gutter）。
    expect(screen.getAllByText("+").length).toBeGreaterThan(0);
    // 无旧版 diff 区与执行结果区。
    expect(screen.queryByText("大纲变更")).not.toBeInTheDocument();
    expect(screen.queryByText("正文变更")).not.toBeInTheDocument();
    expect(screen.queryByText("实体变更")).not.toBeInTheDocument();
    expect(screen.queryByText("执行结果")).not.toBeInTheDocument();
  });

  it("shows the pending pill without an item count for a single request", async () => {
    const store = await makeStore([queueItem()]);
    render(<ApprovalPanel store={store} />);
    // 目录行 pill 保留（待批准），单请求无「N 项」计数。
    expect(screen.getAllByText("待批准").length).toBeGreaterThan(0);
    expect(screen.queryByText(/项待批准/)).not.toBeInTheDocument();
  });

  it("renders resolved entity content for delete instead of raw values", async () => {
    const store = await makeStore([
      queueItem({
        requestId: "AR-2",
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
    render(<ApprovalPanel store={store} resolveEntity={resolveEntity} />);
    expect(await screen.findByText("夏、夏夏")).toBeInTheDocument();
    expect(screen.getByText("名称")).toBeInTheDocument();
    // 原始参数未展示。
    expect(screen.queryByText("级联删除")).not.toBeInTheDocument();
  });

  it("renders old→new changes for edit approvals", async () => {
    const store = await makeStore([
      queueItem({
        requestId: "AR-3",
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
    render(<ApprovalPanel store={store} resolveEntity={resolveEntity} />);
    // 红旧/绿新两行，无「改动项」标题。
    expect((await screen.findAllByText("旧简介")).length).toBeGreaterThan(0);
    expect(screen.getByText("新简介")).toBeInTheDocument();
    expect(screen.queryByText("改动项")).not.toBeInTheDocument();
  });

  it("shows the stale banner when the resolver flags stale and hides otherwise", async () => {
    const store = await makeStore([
      queueItem({
        requestId: "AR-4",
        toolName: "NovelDelete",
        args: JSON.stringify({ values: [{ kind: "character", id: "c-1" }] }),
      }),
    ]);
    const staleResolver = vi.fn(async (): Promise<ResolvedEntityContent> => ({
      kind: "character",
      id: "c-1",
      name: "林夏",
      op: "delete",
      fields: [],
      stale: true,
    }));
    const freshResolver = vi.fn(async (): Promise<ResolvedEntityContent> => ({
      kind: "character",
      id: "c-1",
      name: "林夏",
      op: "delete",
      fields: [],
      stale: false,
    }));
    const { rerender } = render(
      <ApprovalPanel store={store} resolveEntity={staleResolver} />,
    );
    expect(await screen.findByText(/版本已过期/)).toBeInTheDocument();
    rerender(<ApprovalPanel store={store} resolveEntity={freshResolver} />);
    await waitFor(() =>
      expect(screen.queryByText(/版本已过期/)).not.toBeInTheDocument(),
    );
  });

  it("falls back to raw params when resolution fails", async () => {
    const store = await makeStore([
      queueItem({
        requestId: "AR-5",
        toolName: "NovelDelete",
        args: JSON.stringify({
          cascade: false,
          values: [{ kind: "character", id: "c-1" }],
        }),
      }),
    ]);
    const resolveEntity = vi.fn(async () => undefined);
    render(<ApprovalPanel store={store} resolveEntity={resolveEntity} />);
    // 解析失败回退原始参数（级联删除 / 类型）。
    expect(await screen.findByText("级联删除")).toBeInTheDocument();
    expect(screen.getByText("类型")).toBeInTheDocument();
  });

  it("resolves add approval and shows green content", async () => {
    const store = await makeStore([queueItem()]);
    const resolveEntity = vi.fn(async (): Promise<ResolvedEntityContent> => ({
      kind: "character",
      id: "add-character-0",
      name: "林夏",
      op: "add",
      fields: [{ field: "name", label: "名称", new: "林夏", state: "add" }],
      stale: false,
    }));
    render(<ApprovalPanel store={store} resolveEntity={resolveEntity} />);
    expect((await screen.findAllByText("林夏")).length).toBeGreaterThan(0);
    expect(resolveEntity).toHaveBeenCalled();
  });

  it("renders one resolved block per delete target", async () => {
    const store = await makeStore([
      queueItem({
        requestId: "AR-6",
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
    render(<ApprovalPanel store={store} resolveEntity={resolveEntity} />);
    expect((await screen.findAllByText("林夏")).length).toBeGreaterThan(0);
    expect((await screen.findAllByText("旧船坞")).length).toBeGreaterThan(0);
  });

  it("does not resolve or flag stale for a resolved approval", async () => {
    const store = await makeStore([
      queueItem({
        requestId: "AR-9",
        toolName: "CharacterEdit",
        status: "approved",
        args: JSON.stringify({
          values: [{ characterId: "c-1", baseRevision: 1, patch: { summary: "新简介" } }],
        }),
      }),
    ]);
    const resolveEntity = vi.fn();
    render(<ApprovalPanel store={store} resolveEntity={resolveEntity} />);
    // 已决审批不解析、不显示失效提示，原始参数作参考。
    expect(resolveEntity).not.toHaveBeenCalled();
    expect(screen.queryByText(/版本已过期/)).not.toBeInTheDocument();
    expect(screen.getByText("审批参数")).toBeInTheDocument();
    expect(screen.getByText("新简介")).toBeInTheDocument();
  });
});
