/**
 * inspector 组件测试：恒挂载开合 + 路由渲染 + 拖拽调宽（--insp-w）+ 审批目录分组。
 *
 * jsdom 不评估媒体查询 / @container / 布局，因此只断言 inline style / class / aria；
 * 抽屉与响应式宽度只验证状态与 inline 变量（--insp-w）。
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InspectorRouter } from "../../src/shared/routing/InspectorRouter.js";
import { InspectorHost } from "../../src/shell/inspector/InspectorHost.js";
import { ConversationCatalogStore } from "../../src/domains/conversation/store/ConversationCatalogStore.js";
import { StoryOutlineTreeStore } from "../../src/domains/novel/outline/store/StoryOutlineTreeStore.js";
import { CharacterStore } from "../../src/domains/novel/character/store/CharacterStore.js";
import { LocationStore } from "../../src/domains/novel/location/store/LocationStore.js";
import { ApprovalStore, type ApprovalView } from "../../src/domains/approval/ApprovalStore.js";

function buildApi() {
  return {
    conversations: { list: vi.fn(async () => ({ conversations: [] })), create: vi.fn(), open: vi.fn() },
    novel: {
      overview: { get: vi.fn() },
      outline: {
        get: vi.fn(async () => ({
          schemaVersion: 1,
          scope: { kind: "canonical" },
          tree: {
            outline: { id: "o1", novelId: "n1" },
            units: [
              {
                id: "arc-v1",
                outlineId: "o1",
                orderKey: "0001",
                title: "第一卷",
                scope: "arc",
                planningStatus: "ready",
                realizationStatus: "in-progress",
              },
            ],
          },
          progress: [],
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
  const api = buildApi();
  const conversationCatalog = new ConversationCatalogStore({ api });
  const outlineTree = new StoryOutlineTreeStore({ api });
  const characters = new CharacterStore({ api });
  const locations = new LocationStore({ api });
  const approvalStore = new ApprovalStore();
  await conversationCatalog.loadWorkspace("w1");
  await outlineTree.loadWorkspace("w1");
  await characters.loadWorkspace("w1");
  await locations.loadWorkspace("w1");
  return { conversationCatalog, outlineTree, characters, locations, approvalStore };
}

/** 待审审批（chapter 变更，归入「正文变更」区）。 */
function pendingChapterApproval(conversationId: string): ApprovalView {
  return {
    conversationId,
    conversationStatus: "active",
    approvalRequestId: "r1",
    turnId: "t1",
    toolName: "novel",
    title: "新增第一章",
    status: "pending",
    requestedAt: "2026-08-05T09:00:00.000Z",
    operations: [{ op: "add", kind: "chapter", id: "ch1", title: "第一章" }],
    argumentDigest: "sha256:abc",
  };
}

describe("InspectorHost", () => {
  it("keeps the aside mounted but hidden when closed", async () => {
    const stores = await makeStores();
    render(<InspectorHost inspectorRouter={new InspectorRouter()} {...stores} />);
    const aside = document.querySelector("aside") as HTMLElement;
    expect(aside).not.toBeNull();
    expect(aside.getAttribute("aria-hidden")).toBe("true");
    expect(aside.hasAttribute("inert")).toBe(true);
    expect(aside.classList.contains("open")).toBe(false);
    expect(aside.style.getPropertyValue("--insp-w")).toBe("");
  });

  it("renders outline unit panel by route", async () => {
    const stores = await makeStores();
    const router = new InspectorRouter();
    router.transition({ kind: "outlineUnit", unitId: "arc-v1" });
    render(<InspectorHost inspectorRouter={router} {...stores} />);
    expect(screen.getByText("第一卷")).toBeInTheDocument();
  });

  it("renders approval tabs and empty panel for approval route", async () => {
    const stores = await makeStores();
    const router = new InspectorRouter();
    router.transition({ kind: "approval", changeSetId: "CS-1" });
    render(<InspectorHost inspectorRouter={router} {...stores} />);
    expect(screen.getByRole("tab", { name: "审批" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "档案" })).not.toBeInTheDocument();
    expect(screen.getByText("暂无审批请求")).toBeInTheDocument();
  });

  it("resizes via the drag handle writing --insp-w", async () => {
    const stores = await makeStores();
    const router = new InspectorRouter();
    router.transition({ kind: "conversation", conversationId: "c1" });
    // 大视口：minW 560、maxW min(1120, 1400-520)=880；860+60 → clamp 到 880。
    Object.defineProperty(window, "innerWidth", {
      value: 1400,
      configurable: true,
      writable: true,
    });
    render(<InspectorHost inspectorRouter={router} {...stores} />);
    const aside = document.querySelector("aside") as HTMLElement;
    const handle = aside.querySelector('[role="separator"]') as Element;
    fireEvent.pointerDown(handle, { button: 0, clientX: 100, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: 160, clientY: 0 });
    await new Promise((resolve) => requestAnimationFrame(() => resolve()));
    fireEvent.pointerUp(window);
    expect(aside.style.getPropertyValue("--insp-w")).toBe("880px");
  });

  it("groups approval directory by conversation and jumps", async () => {
    const user = userEvent.setup();
    const stores = await makeStores();
    const router = new InspectorRouter();
    router.transition({ kind: "approval", changeSetId: "CS-1" });
    stores.approvalStore.setApprovals([
      pendingChapterApproval("conv-a"),
      {
        ...pendingChapterApproval("conv-b"),
        approvalRequestId: "r2",
        title: "新增角色",
        operations: [{ op: "add", kind: "character", id: "c1", title: "张三" }],
        requestedAt: "2026-08-05T09:10:00.000Z",
      },
    ]);
    const onJump = vi.fn();
    render(
      <InspectorHost
        inspectorRouter={router}
        {...stores}
        onJumpToConversation={onJump}
      />,
    );
    // 目录按对话分组：两段对话名 + 两个「跳转」按钮。
    expect(screen.getByText("conv-a")).toBeInTheDocument();
    expect(screen.getByText("conv-b")).toBeInTheDocument();
    const jumpButtons = screen.getAllByRole("button", { name: "跳转" });
    expect(jumpButtons).toHaveLength(2);
    // 组按最近审批降序：conv-b（09:10）在前。
    await user.click(jumpButtons[0]);
    expect(onJump).toHaveBeenNthCalledWith(1, "conv-b");
    await user.click(jumpButtons[1]);
    expect(onJump).toHaveBeenNthCalledWith(2, "conv-a");
    // 选中组详情：diff 标题与 op kind 中文化。
    expect(screen.getByText("实体变更")).toBeInTheDocument();
    expect(screen.getByText("人物")).toBeInTheDocument();
  });

  it("toggles the approval drawer and auto-collapses on select", async () => {
    const user = userEvent.setup();
    const stores = await makeStores();
    const router = new InspectorRouter();
    router.transition({ kind: "approval", changeSetId: "CS-1" });
    stores.approvalStore.setApprovals([pendingChapterApproval("conv-a")]);
    render(<InspectorHost inspectorRouter={router} {...stores} />);
    const panel = document.querySelector(".panel") as HTMLElement;
    expect(panel.classList.contains("drawerOpen")).toBe(false);
    await user.click(screen.getByRole("button", { name: /审批队列/ }));
    expect(panel.classList.contains("drawerOpen")).toBe(true);
    await user.click(screen.getByRole("button", { name: /新增第一章/ }));
    expect(panel.classList.contains("drawerOpen")).toBe(false);
  });
});
