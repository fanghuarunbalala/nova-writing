/**
 * inspector 组件测试：恒挂载开合 + 路由渲染（conversation 面板）。
 * 审批已弹窗化（方案 A v0.8）：审批交互见 tests/domains/approval/components/ApprovalModal.test.tsx。
 *
 * jsdom 不评估媒体查询 / @container / 布局，因此只断言 inline style / class / aria。
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { InspectorRouter } from "../../src/shared/routing/InspectorRouter.js";
import { InspectorHost } from "../../src/shell/inspector/InspectorHost.js";
import { ContentDirectoryStore } from "../../src/shell/inspector/ContentDirectoryStore.js";
import { ConversationCatalogStore } from "../../src/domains/conversation/store/ConversationCatalogStore.js";
import { StoryOutlineTreeStore } from "../../src/domains/novel/outline/store/StoryOutlineTreeStore.js";
import { CharacterStore } from "../../src/domains/novel/character/store/CharacterStore.js";
import { LocationStore } from "../../src/domains/novel/location/store/LocationStore.js";

function buildApi() {
  return {
    conversations: {
      list: vi.fn(async () => [
        { conversationId: "conv-a", name: "conv-a", storeDir: "", status: "active" as const },
      ]),
      create: vi.fn(),
      open: vi.fn(),
    },
    novel: {
      overview: { get: vi.fn() },
      outline: {
        get: vi.fn(async () => ({ schemaVersion: 1, scope: { kind: "canonical" }, units: [] })),
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
  await conversationCatalog.loadWorkspace("w1");
  await outlineTree.loadWorkspace("w1");
  await characters.loadWorkspace("w1");
  await locations.loadWorkspace("w1");
  return {
    conversationCatalog,
    outlineTree,
    characters,
    locations,
    contentDirectory: new ContentDirectoryStore(),
    onSelectOutlineUnit: vi.fn(),
    onOpenCharacter: vi.fn(),
    onOpenLocation: vi.fn(),
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
  });

  it("hides panel outside chat view but restores it on return (AP-1)", async () => {
    const stores = await makeStores();
    const router = new InspectorRouter();
    router.transition({ kind: "conversation", conversationId: "conv-a" });
    const { rerender } = render(
      <InspectorHost inspectorRouter={router} visible={false} {...stores} />,
    );
    const aside = document.querySelector("aside") as HTMLElement;
    expect(aside.getAttribute("aria-hidden")).toBe("true");
    rerender(<InspectorHost inspectorRouter={router} visible {...stores} />);
    expect(aside.getAttribute("aria-hidden")).toBe("false");
    expect(screen.getByRole("heading", { name: "对话元信息" })).toBeInTheDocument();
  });

  it("renders conversation panel header for conversation route", async () => {
    const stores = await makeStores();
    const router = new InspectorRouter();
    router.transition({ kind: "conversation", conversationId: "conv-a" });
    render(<InspectorHost inspectorRouter={router} {...stores} />);
    expect(screen.getByRole("heading", { name: "对话元信息" })).toBeInTheDocument();
  });

  it("renders content directory for directory route (chat 默认态)", async () => {
    const stores = await makeStores();
    const router = new InspectorRouter();
    router.transition({ kind: "directory" });
    render(<InspectorHost inspectorRouter={router} {...stores} />);
    expect(screen.getByRole("heading", { name: "内容目录" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /大纲/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /人物/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /地点/ })).toBeInTheDocument();
  });

  it("injects custom width and resets on grip double-click (拖宽/复位)", async () => {
    const stores = await makeStores();
    const router = new InspectorRouter();
    router.transition({ kind: "directory" });
    const onWidthChange = vi.fn();
    const { rerender } = render(
      <InspectorHost inspectorRouter={router} {...stores} widthPx={500} onWidthChange={onWidthChange} />,
    );
    // 自定义宽度经 inline --insp-w 注入（jsdom 无 matchMedia → 视为宽档）
    const aside = document.querySelector("aside") as HTMLElement;
    expect(aside.style.getPropertyValue("--insp-w")).toBe("500px");
    // 双击把手 → 复位回调（undefined = 断点缺省）
    const grip = screen.getByRole("separator", { name: "拖拽调整目录宽度" });
    grip.parentElement?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(onWidthChange).toHaveBeenCalledWith(undefined);
    // 复位后（widthPx=undefined）不再注入 inline 宽度
    rerender(
      <InspectorHost inspectorRouter={router} {...stores} onWidthChange={onWidthChange} />,
    );
    expect(aside.style.getPropertyValue("--insp-w")).toBe("");
  });
});
