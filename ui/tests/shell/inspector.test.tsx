/**
 * inspector 组件测试：恒挂载开合 + 路由渲染 + 拖拽调宽（--insp-w）+ 审批目录分组。
 *
 * jsdom 不评估媒体查询 / @container / 布局，因此只断言 inline style / class / aria；
 * 抽屉与响应式宽度只验证状态与 inline 变量（--insp-w）。
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ApprovalQueueItem } from "@novel/core";
import { InspectorRouter } from "../../src/shared/routing/InspectorRouter.js";
import { InspectorHost } from "../../src/shell/inspector/InspectorHost.js";
import { ConversationCatalogStore } from "../../src/domains/conversation/store/ConversationCatalogStore.js";
import { StoryOutlineTreeStore } from "../../src/domains/novel/outline/store/StoryOutlineTreeStore.js";
import { CharacterStore } from "../../src/domains/novel/character/store/CharacterStore.js";
import { LocationStore } from "../../src/domains/novel/location/store/LocationStore.js";
import { ApprovalStore } from "../../src/domains/approval/ApprovalStore.js";

function buildApi(items: readonly ApprovalQueueItem[] = []) {
  return {
    conversations: { list: vi.fn(async () => ({ conversations: [] })), create: vi.fn(), open: vi.fn() },
    approvals: {
      list: vi.fn(async () => items),
      resolve: vi.fn(async () => true),
    },
    novel: {
      overview: { get: vi.fn() },
      outline: {
        get: vi.fn(async () => ({
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
        })),
        getStoryUnit: vi.fn(),
      },
      characters: {
        list: vi.fn(async () => []),
        get: vi.fn(),
      },
      locations: {
        list: vi.fn(async () => []),
        get: vi.fn(),
      },
      paragraphs: { list: vi.fn(), get: vi.fn() },
      publication: { get: vi.fn() },
    },
  } as never;
}

async function makeStores(approvals: readonly ApprovalQueueItem[] = []) {
  const api = buildApi(approvals);
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

/** 待审审批（组标题由 args 派生：values[0].title）。 */
function pendingApproval(conversationId: string, title: string, requestedAt: string): ApprovalQueueItem {
  return {
    conversationId,
    requestId: `r_${conversationId}`,
    toolName: "ParagraphWrite",
    args: JSON.stringify({ values: [{ title }] }),
    decisioner: "ui",
    status: "pending",
    requestedAt,
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
    // 大视口：minW 560、maxW min(1120, 1400-520)=880；860+60 → clamp 到 880。
    Object.defineProperty(window, "innerWidth", {
      value: 1400,
      configurable: true,
      writable: true,
    });
    render(<InspectorHost inspectorRouter={router} {...stores} />);
    const aside = document.querySelector("aside") as HTMLElement;
    const handle = aside.querySelector('[role="separator"]') as Element;
    // 左缘把手向左拖变宽（InspectorHost.handleResize 语义）：860+60 → clamp 到 880。
    fireEvent.pointerDown(handle, { button: 0, clientX: 160, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: 100, clientY: 0 });
    await new Promise((resolve) => requestAnimationFrame(() => resolve()));
    fireEvent.pointerUp(window);
    expect(aside.style.getPropertyValue("--insp-w")).toBe("880px");
  });

  it("groups approval directory by conversation and jumps", async () => {
    const user = userEvent.setup();
    const stores = await makeStores([
      pendingApproval("conv-a", "新增第一章", "2026-08-05T09:00:00.000Z"),
      pendingApproval("conv-b", "新增角色", "2026-08-05T09:10:00.000Z"),
    ]);
    const router = new InspectorRouter();
    router.transition({ kind: "approval", changeSetId: "CS-1" });
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
    // 选中组详情：无 diff 区；解析器未注入时按参数平铺展示。
    expect(screen.queryByText("实体变更")).not.toBeInTheDocument();
    expect(screen.queryByText("正文变更")).not.toBeInTheDocument();
    expect(screen.getByText("标题")).toBeInTheDocument();
  });

  it("toggles the approval drawer and auto-collapses on select", async () => {
    const user = userEvent.setup();
    const stores = await makeStores([
      pendingApproval("conv-a", "新增第一章", "2026-08-05T09:00:00.000Z"),
    ]);
    const router = new InspectorRouter();
    router.transition({ kind: "approval", changeSetId: "CS-1" });
    render(<InspectorHost inspectorRouter={router} {...stores} />);
    const panel = document.querySelector(".panel") as HTMLElement;
    expect(panel.classList.contains("drawerOpen")).toBe(false);
    await user.click(screen.getByRole("button", { name: /目录/ }));
    expect(panel.classList.contains("drawerOpen")).toBe(true);
    await user.click(screen.getByRole("button", { name: /新增第一章/ }));
    expect(panel.classList.contains("drawerOpen")).toBe(false);
  });
});
