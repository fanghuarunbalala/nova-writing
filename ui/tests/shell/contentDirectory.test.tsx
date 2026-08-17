/**
 * ContentDirectoryPanel 单测（右栏内容目录）：
 * 四 tab 切换（大纲/正文/人物/地点）、大纲所有节点点击就地展开详情卡
 * （含父节点，跳转只走卡内按钮）、正文 tab 卷章目录 + 章点击跳正文回调、
 * 人物/地点目录行手风琴（单开）、详情卡（简介 + 打开完整档案跳转）、
 * store.locate 定位（切 tab + 展开 + 滚动）。
 * jsdom 无 scrollIntoView：测试内 mock。
 */
import { describe, expect, it, vi, beforeAll } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ContentDirectoryStore } from "../../src/shell/inspector/ContentDirectoryStore.js";
import { ContentDirectoryPanel } from "../../src/shell/inspector/panels/ContentDirectoryPanel.js";
import { CharacterStore } from "../../src/domains/novel/character/store/CharacterStore.js";
import { LocationStore } from "../../src/domains/novel/location/store/LocationStore.js";
import { ManuscriptStructureStore } from "../../src/domains/novel/manuscript/store/ManuscriptStructureStore.js";
import { StoryOutlineTreeStore } from "../../src/domains/novel/outline/store/StoryOutlineTreeStore.js";

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

function character(id: string, name: string, summary: string) {
  return {
    id,
    name,
    aliases: ["主角"],
    summary,
    initialState: `${name}的初始状态`,
    authorNotes: "作者备注",
    entityVersion: 3,
  };
}

function buildApi() {
  return {
    novel: {
      overview: { get: vi.fn() },
      outline: {
        get: vi.fn(async () => ({
          schemaVersion: 1,
          scope: { kind: "canonical" },
          units: [
            {
              id: "u0",
              orderKey: "0000",
              title: "第一幕 · 旧港",
              scope: "arc",
              planningStatus: "ready",
              realizationStatus: "in-progress",
            },
            {
              id: "u1",
              parentId: "u0",
              orderKey: "0001",
              title: "第一章 · 雾起",
              scope: "scene",
              planningStatus: "ready",
              realizationStatus: "in-progress",
              // leaf 绑定（部分字段）：档案「关联单元」派生数据源
              leaf: {
                characters: [{ characterId: "c-1" }],
                locations: [{ locationId: "l-1" }],
              },
            },
          ],
        })),
        getStoryUnit: vi.fn(),
      },
      // 新 core 契约：list/get 直接返回实体数组/实体（无 schemaVersion/scope 包装）
      characters: {
        list: vi.fn(async () => [
          character("c-1", "林夏", "旧船坞长大的孤女"),
          character("c-2", "苏眉", "茶馆老板娘"),
        ]),
        get: vi.fn(async (id: string) =>
          id === "c-1" ? character("c-1", "林夏", "旧船坞长大的孤女") : character("c-2", "苏眉", "茶馆老板娘"),
        ),
      },
      locations: {
        list: vi.fn(async () => [
          {
            id: "l-1",
            name: "旧船坞",
            aliases: ["船坞"],
            summary: "废弃的修船坞",
            authorNotes: "",
            entityVersion: 2,
          },
        ]),
        get: vi.fn(async () => ({
          id: "l-1",
          name: "旧船坞",
          aliases: ["船坞"],
          summary: "废弃的修船坞",
          authorNotes: "",
          entityVersion: 2,
        })),
      },
      publication: {
        get: vi.fn(async () => ({
          volumes: [{ id: "vol-1", title: "第一卷 · 旧港潮声" }],
          chapters: [
            {
              id: "ch-1",
              volumeId: "vol-1",
              title: "雾起",
              entityVersion: 1,
              storyUnitId: "u1",
              paragraphIds: ["p-1"],
            },
          ],
        })),
      },
      paragraphs: {
        list: vi.fn(async () => [
          { id: "p-1", storyUnitId: "u1", text: "雾从旧船坞漫上来。", entityVersion: 1, orderKey: "0001" },
        ]),
      },
      manuscript: {},
    },
  } as never;
}

async function makeStores() {
  const api = buildApi();
  const outlineTree = new StoryOutlineTreeStore({ api });
  const characters = new CharacterStore({ api });
  const locations = new LocationStore({ api });
  const manuscript = new ManuscriptStructureStore({ api });
  await outlineTree.loadWorkspace("w1");
  await characters.loadWorkspace("w1");
  await locations.loadWorkspace("w1");
  await manuscript.loadWorkspace("w1");
  return { outlineTree, characters, locations, manuscript };
}

function renderPanel(
  stores: Awaited<ReturnType<typeof makeStores>>,
  dirStore = new ContentDirectoryStore(),
) {
  const onSelectOutlineUnit = vi.fn();
  const onOpenChapter = vi.fn();
  const onOpenCharacter = vi.fn();
  const onOpenLocation = vi.fn();
  render(
    <ContentDirectoryPanel
      store={dirStore}
      outlineTree={stores.outlineTree}
      manuscript={stores.manuscript}
      characters={stores.characters}
      locations={stores.locations}
      onSelectOutlineUnit={onSelectOutlineUnit}
      onOpenChapter={onOpenChapter}
      onOpenCharacter={onOpenCharacter}
      onOpenLocation={onOpenLocation}
    />,
  );
  return { dirStore, onSelectOutlineUnit, onOpenChapter, onOpenCharacter, onOpenLocation };
}

describe("ContentDirectoryPanel", () => {
  it("renders four tabs and switches to characters list", async () => {
    const stores = await makeStores();
    renderPanel(stores);
    expect(screen.getByRole("tab", { name: /大纲/ }).getAttribute("aria-selected")).toBe("true");
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: /人物/ }));
    expect(screen.getByText("林夏")).toBeInTheDocument();
    expect(screen.getByText("苏眉")).toBeInTheDocument();
  });

  it("expands one detail card at a time (手风琴单开) and opens full archive", async () => {
    const stores = await makeStores();
    const { onOpenCharacter } = renderPanel(stores);
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: /人物/ }));
    // 展开第一行：详情卡出现（detail 懒加载后显示简介与初始状态）
    await user.click(screen.getByRole("button", { name: /林夏/ }));
    expect(await screen.findByText("旧船坞长大的孤女")).toBeInTheDocument();
    expect(screen.getByText("林夏的初始状态")).toBeInTheDocument();
    // 打开完整档案 → 跳内容视图回调
    await user.click(screen.getByRole("button", { name: /打开完整档案/ }));
    expect(onOpenCharacter).toHaveBeenCalledWith("c-1");
    // 展开第二行 → 第一行详情收起（单开）
    await user.click(screen.getByRole("button", { name: /苏眉/ }));
    await waitFor(() => {
      expect(screen.getByText("茶馆老板娘")).toBeInTheDocument();
      expect(screen.queryByText("林夏的初始状态")).not.toBeInTheDocument();
    });
  });

  it("locate() switches tab, expands the target and scrolls to its row", async () => {
    const stores = await makeStores();
    const { dirStore } = renderPanel(stores);
    // 初始在大纲 tab；locate 地点 → 自动切 tab + 展开 + scrollIntoView
    dirStore.locate("location", "l-1");
    expect(await screen.findByText("废弃的修船坞")).toBeInTheDocument();
    await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled());
  });

  it("renders locations list with open callback", async () => {
    const stores = await makeStores();
    const { onOpenLocation } = renderPanel(stores);
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: /地点/ }));
    await user.click(screen.getByRole("button", { name: /旧船坞/ }));
    await user.click(await screen.findByRole("button", { name: /打开完整档案/ }));
    expect(onOpenLocation).toHaveBeenCalledWith("l-1");
  });

  it("outline click expands a brief card for every node (no direct navigation)", async () => {
    const stores = await makeStores();
    const { onSelectOutlineUnit } = renderPanel(stores);
    const user = userEvent.setup();
    // 父节点（含顶层）行点击 → 就地展开简略卡（意图/梗概 + 跳转钮），不整页跳转
    await user.click(screen.getByRole("button", { name: /第一幕 · 旧港/ }));
    expect(onSelectOutlineUnit).not.toHaveBeenCalled();
    expect(screen.getByText("意图")).toBeInTheDocument();
    expect(screen.getByText("梗概")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /查看单元详情/ }));
    expect(onSelectOutlineUnit).toHaveBeenCalledWith("u0");
    // leaf（无子级）行为一致：点击展开卡，卡内按钮才跳转
    await user.click(screen.getByRole("button", { name: /第一章 · 雾起/ }));
    expect(screen.getByText("意图")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /查看单元详情/ }));
    expect(onSelectOutlineUnit).toHaveBeenCalledWith("u1");
    // 再点行 → 收起简略卡
    await user.click(screen.getByRole("button", { name: /第一章 · 雾起/ }));
    expect(screen.queryByRole("button", { name: /查看单元详情/ })).not.toBeInTheDocument();
  });

  it("manuscript tab lists volumes/chapters and chapter click jumps to text", async () => {
    const stores = await makeStores();
    const { onOpenChapter } = renderPanel(stores);
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: /正文/ }));
    expect(screen.getByText("第一卷 · 旧港潮声")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /雾起/ }));
    expect(onOpenChapter).toHaveBeenCalledWith("ch-1");
  });

  it("shows related units derived from outline leaf bindings in entity cards", async () => {
    const stores = await makeStores();
    renderPanel(stores);
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: /人物/ }));
    await user.click(screen.getByRole("button", { name: /林夏/ }));
    // 详情卡「关联单元」chip = leaf 绑定派生（c-1 出场于 u1）
    expect(await screen.findByText("第一章 · 雾起")).toBeInTheDocument();
  });
});
