/**
 * inspector 组件测试：路由渲染 + 拖拽调宽。
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { InspectorRouter } from "../../src/shared/routing/InspectorRouter.js";
import { InspectorHost } from "../../src/shell/inspector/InspectorHost.js";
import { ConversationCatalogStore } from "../../src/domains/conversation/store/ConversationCatalogStore.js";
import { StoryOutlineTreeStore } from "../../src/domains/novel/outline/store/StoryOutlineTreeStore.js";
import { CharacterStore } from "../../src/domains/novel/character/store/CharacterStore.js";
import { LocationStore } from "../../src/domains/novel/location/store/LocationStore.js";
import { ApprovalStore } from "../../src/domains/approval/ApprovalStore.js";

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

describe("InspectorHost", () => {
  it("renders nothing when closed", async () => {
    const stores = await makeStores();
    render(<InspectorHost inspectorRouter={new InspectorRouter()} {...stores} />);
    expect(document.querySelector("aside")).toBeNull();
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
    expect(screen.getByRole("tab", { name: "档案" })).toBeInTheDocument();
    expect(screen.getByText("暂无审批请求")).toBeInTheDocument();
  });

  it("resizes via the drag handle", async () => {
    const stores = await makeStores();
    const router = new InspectorRouter();
    router.transition({ kind: "conversation", conversationId: "c1" });
    render(<InspectorHost inspectorRouter={router} {...stores} />);
    const aside = document.querySelector("aside") as HTMLElement;
    const handle = aside.querySelector('[role="separator"]') as Element;
    fireEvent.pointerDown(handle, { button: 0, clientX: 100, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: 160, clientY: 0 });
    await new Promise((resolve) => requestAnimationFrame(() => resolve()));
    fireEvent.pointerUp(window);
    expect(aside.style.width).toBe("444px");
  });
});
