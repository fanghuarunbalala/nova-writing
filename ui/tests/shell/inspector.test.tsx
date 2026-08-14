/**
 * inspector 组件测试：恒挂载开合 + 路由渲染 + 拖拽调宽（--insp-w）+ 审批目录会话化。
 *
 * jsdom 不评估媒体查询 / @container / 布局，因此只断言 inline style / class / aria；
 * 抽屉与响应式宽度只验证状态与 inline 变量（--insp-w）。
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
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
    toolName: "CharacterWrite",
    args: JSON.stringify({ values: [{ name }] }),
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
  return { conversationCatalog, outlineTree, characters, locations, approvalStore };
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

  it("renders approval header title, directory toggle and empty panel for approval route", async () => {
    const stores = await makeStores();
    const router = new InspectorRouter();
    router.transition({ kind: "approval", changeSetId: "CS-1" });
    render(<InspectorHost inspectorRouter={router} {...stores} />);
    expect(screen.getByRole("heading", { name: "审批" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /目录/ })).toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(screen.getByText("暂无审批请求")).toBeInTheDocument();
  });

  it("resizes via the drag handle writing --insp-w", async () => {
    const stores = await makeStores();
    const router = new InspectorRouter();
    router.transition({ kind: "conversation", conversationId: "c1" });
    // 大视口：minW 560、maxW min(1120, 1400-520)=880；向右拖 60 → 收窄 60（860 → 800）。
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
    expect(aside.style.getPropertyValue("--insp-w")).toBe("800px");
  });

  it("shows only the active conversation's approvals with a per-conversation badge", async () => {
    const stores = await makeStores();
    const router = new InspectorRouter();
    router.transition({ kind: "approval", changeSetId: "CS-1" });
    approvalsBacking = [
      pendingApproval("conv-a", "r1", "林夏"),
      pendingApproval("conv-b", "r2", "苏眉"),
    ];
    await stores.approvalStore.refresh();
    render(<InspectorHost inspectorRouter={router} {...stores} />);
    // 活动会话 = conv-a（catalog 列表第一条）：目录只列它的审批记录。
    expect(screen.getAllByText("林夏").length).toBeGreaterThan(0);
    expect(screen.queryByText("苏眉")).not.toBeInTheDocument();
    // 「目录」徽标 = 当前会话待审批数（1，而非全局 2）。
    const dirButton = screen.getByRole("button", { name: /目录/ });
    expect(within(dirButton).getByText("1")).toBeInTheDocument();
    // 跨会话「跳转」按钮已移除。
    expect(screen.queryByRole("button", { name: "跳转" })).not.toBeInTheDocument();
  });

  it("toggles the approval drawer and auto-collapses on select", async () => {
    const user = userEvent.setup();
    const stores = await makeStores();
    const router = new InspectorRouter();
    router.transition({ kind: "approval", changeSetId: "CS-1" });
    approvalsBacking = [pendingApproval("conv-a", "r1", "林夏")];
    await stores.approvalStore.refresh();
    render(<InspectorHost inspectorRouter={router} {...stores} />);
    const panel = document.querySelector(".panel") as HTMLElement;
    expect(panel.classList.contains("drawerOpen")).toBe(false);
    await user.click(screen.getByRole("button", { name: /目录/ }));
    expect(panel.classList.contains("drawerOpen")).toBe(true);
    await user.click(screen.getByRole("button", { name: /林夏/ }));
    expect(panel.classList.contains("drawerOpen")).toBe(false);
  });
});
