/**
 * inspector 组件测试：恒挂载开合 + 路由渲染 + 审批卡片流会话化（PRD AP）。
 *
 * jsdom 不评估媒体查询 / @container / 布局，因此只断言 inline style / class / aria；
 * 审批面板为卡片流（无目录抽屉、无拖拽调宽——决议 2/PRD AP-3）。
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ApprovalQueueItem } from "@novel/core";
import { InspectorRouter } from "../../src/shared/routing/InspectorRouter.js";
import { InspectorHost } from "../../src/shell/inspector/InspectorHost.js";
import { ConversationCatalogStore } from "../../src/domains/conversation/store/ConversationCatalogStore.js";
import { StoryOutlineTreeStore } from "../../src/domains/novel/outline/store/StoryOutlineTreeStore.js";
import { CharacterStore } from "../../src/domains/novel/character/store/CharacterStore.js";
import { LocationStore } from "../../src/domains/novel/location/store/LocationStore.js";
import { ApprovalStore } from "../../src/domains/approval/ApprovalStore.js";

/** 审批队列条目夹具（args 为 JSON 字符串，与 CMS wait 队列一致） */
function pendingApproval(conversationId: string, requestId: string, name: string): ApprovalQueueItem {
  return {
    conversationId,
    requestId,
    toolCalls: [
      { toolCallId: "t1", toolName: "CharacterWrite", args: JSON.stringify({ values: [{ name }] }) },
    ],
    decisioner: "ui",
    status: "pending",
    requestedAt: "2026-08-05T09:00:00.000Z",
  };
}

/** 审批队列的可变后备数据（测试内改列表后 refresh） */
let approvalsBacking: ApprovalQueueItem[] = [];

function buildApi() {
  return {
    conversations: {
      list: vi.fn(async () => [
        { conversationId: "conv-a", name: "conv-a", storeDir: "", status: "active" as const },
      ]),
      create: vi.fn(),
      open: vi.fn(),
    },
    approvals: {
      list: vi.fn(async () => approvalsBacking),
      resolve: vi.fn(async () => true),
    },
    novel: {
      overview: { get: vi.fn() },
      outline: {
        get: vi.fn(async () => ({
          schemaVersion: 1,
          scope: { kind: "canonical" },
          units: [
            {
              id: "arc-v1",
              orderKey: "0001",
              title: "第一卷",
              scope: "arc",
              planningStatus: "ready",
              realizationStatus: "in-progress",
            },
          ],
        })),
        getStoryUnit: vi.fn(),
      },
      characters: {
        list: vi.fn(async () => ({ schemaVersion: 1, scope: { kind: "canonical" }, characters: [] })),
        get: vi.fn(),
      },
      locations: {
        list: vi.fn(async () => ({ schemaVersion: 1, scope: { kind: "canonical" }, locations: [] })),
        get: vi.fn(),
      },
      manuscript: {},
    },
  } as never;
}

async function makeStores() {
  approvalsBacking = [];
  const api = buildApi();
  const conversationCatalog = new ConversationCatalogStore({ api });
  const outlineTree = new StoryOutlineTreeStore({ api });
  const characters = new CharacterStore({ api });
  const locations = new LocationStore({ api });
  const approvalStore = new ApprovalStore({ api });
  await conversationCatalog.loadWorkspace("w1");
  await outlineTree.loadWorkspace("w1");
  await characters.loadWorkspace("w1");
  await locations.loadWorkspace("w1");
  await approvalStore.refresh();
  const stores = { conversationCatalog, outlineTree, characters, locations, approvalStore };
  return { api, stores };
}

describe("InspectorHost", () => {
  it("keeps the aside mounted but hidden when closed", async () => {
    const { stores } = await makeStores();
    render(<InspectorHost inspectorRouter={new InspectorRouter()} {...stores} />);
    const aside = document.querySelector("aside") as HTMLElement;
    expect(aside).not.toBeNull();
    expect(aside.getAttribute("aria-hidden")).toBe("true");
    expect(aside.hasAttribute("inert")).toBe(true);
    expect(aside.classList.contains("open")).toBe(false);
  });

  it("hides approval panel outside chat view but restores it on return (AP-1)", async () => {
    const { stores } = await makeStores();
    const router = new InspectorRouter();
    router.transition({ kind: "approval", changeSetId: "CS-1" });
    const { rerender } = render(
      <InspectorHost inspectorRouter={router} visible={false} {...stores} />,
    );
    const aside = document.querySelector("aside") as HTMLElement;
    expect(aside.getAttribute("aria-hidden")).toBe("true");
    rerender(<InspectorHost inspectorRouter={router} visible {...stores} />);
    expect(aside.getAttribute("aria-hidden")).toBe("false");
    expect(screen.getByRole("heading", { name: "审批" })).toBeInTheDocument();
  });

  it("renders approval header and empty card area for approval route (no directory)", async () => {
    const { stores } = await makeStores();
    const router = new InspectorRouter();
    router.transition({ kind: "approval", changeSetId: "CS-1" });
    render(<InspectorHost inspectorRouter={router} {...stores} />);
    expect(screen.getByRole("heading", { name: "审批" })).toBeInTheDocument();
    expect(screen.getByText("当前对话 · 一次调用一批")).toBeInTheDocument();
    // PRD AP-3：无目录抽屉（目录按钮与 tab 均不存在）。
    expect(screen.queryByRole("button", { name: /目录/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(screen.getByText("暂无审批请求")).toBeInTheDocument();
  });

  it("shows only the active conversation's approvals as cards with badge", async () => {
    const { stores } = await makeStores();
    const router = new InspectorRouter();
    router.transition({ kind: "approval", changeSetId: "CS-1" });
    approvalsBacking = [
      pendingApproval("conv-a", "r1", "林夏"),
      pendingApproval("conv-b", "r2", "苏眉"),
    ];
    await stores.approvalStore.refresh();
    render(<InspectorHost inspectorRouter={router} {...stores} />);
    // 活动会话 = conv-a（catalog 列表第一条）：卡片流只渲染它的审批。
    expect(screen.getAllByText("林夏").length).toBeGreaterThan(0);
    expect(screen.queryByText("苏眉")).not.toBeInTheDocument();
    // 头部徽标 = 当前会话待审批数（1，而非全局 2）。
    const header = document.querySelector("header") as HTMLElement;
    expect(within(header).getByText("1")).toBeInTheDocument();
    // 跨会话「跳转」按钮已移除。
    expect(screen.queryByRole("button", { name: "跳转" })).not.toBeInTheDocument();
  });

  it("decides a pending card inline (approve) without a drawer", async () => {
    const user = userEvent.setup();
    const { api, stores } = await makeStores();
    const router = new InspectorRouter();
    router.transition({ kind: "approval", changeSetId: "CS-1" });
    approvalsBacking = [pendingApproval("conv-a", "r1", "林夏")];
    await stores.approvalStore.refresh();
    render(<InspectorHost inspectorRouter={router} {...stores} />);
    // 卡片自带决策按钮；批准后经 store.decide → api.approvals.resolve。
    await user.click(screen.getByRole("button", { name: "批准" }));
    expect(api.approvals.resolve).toHaveBeenCalledWith("r1", expect.objectContaining({ kind: "approve" }));
  });
});
