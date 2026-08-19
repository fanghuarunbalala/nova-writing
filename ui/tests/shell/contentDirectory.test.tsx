/**
 * ContentDirectoryPanel 单测（右栏内容目录，PRD conversation-目录下钻与实体引用）：
 * 列表 ⇄ 下钻详情页两态——四 tab 切换；大纲父级行点击=展开/收起、场景叶行
 * 点击=进单元详情（完整 leaf + 段落）；正文章行点击=进章详情（段落 + 关联
 * 场景互跳）；人物/地点行点击=进档案页（简介/初始状态/关联单元互跳 + 打开
 * 完整档案）；store.locate 五类直达详情页（paragraph → 章详情 + 段落行）；
 * 目录行 dragstart 写入引用载荷（HTML5 DnD 自定义 MIME）。
 * jsdom 无 scrollIntoView：测试内 mock。
 */
import { describe, expect, it, vi, beforeAll } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ContentDirectoryStore } from "../../src/shell/inspector/ContentDirectoryStore.js";
import { ContentDirectoryPanel } from "../../src/shell/inspector/panels/ContentDirectoryPanel.js";
import { CharacterStore } from "../../src/domains/novel/character/store/CharacterStore.js";
import { LocationStore } from "../../src/domains/novel/location/store/LocationStore.js";
import { ManuscriptStructureStore } from "../../src/domains/novel/manuscript/store/ManuscriptStructureStore.js";
import { StoryOutlineTreeStore } from "../../src/domains/novel/outline/store/StoryOutlineTreeStore.js";
import { REFERENCE_DND_MIME } from "../../src/domains/conversation/reference/referenceDnd.js";

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
              // leaf 绑定（完整数组：档案「关联单元」派生 + 详情页 LeafPlanCard 渲染）
              leaf: {
                settingMode: "located",
                time: { description: "雨夜" },
                characters: [{ characterId: "c-1" }],
                locations: [{ locationId: "l-1" }],
                events: [{ id: "e-1", orderKey: "0001", description: "雾起" }],
                rhythmBeats: [],
                entityChanges: [],
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

function dataTransferStub() {
  const store: Record<string, string> = {};
  return {
    store,
    types: [] as string[],
    effectAllowed: null as string | null,
    dropEffect: null as string | null,
    setData(type: string, value: string) {
      store[type] = value;
      if (!this.types.includes(type)) this.types.push(type);
    },
    getData(type: string) {
      return store[type] ?? "";
    },
  };
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

  it("character row opens the archive detail page (简介/初始状态/关联单元/打开完整档案) and back returns to list", async () => {
    const stores = await makeStores();
    const { onOpenCharacter } = renderPanel(stores);
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: /人物/ }));
    await user.click(screen.getByRole("button", { name: /林夏/ }));
    // 档案页：简介（detail 懒加载）+ 初始状态 + 关联单元 chip + 返回钮
    expect(await screen.findByText("旧船坞长大的孤女")).toBeInTheDocument();
    expect(screen.getByText("林夏的初始状态")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /打开完整档案/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /打开完整档案/ }));
    expect(onOpenCharacter).toHaveBeenCalledWith("c-1");
    await user.click(screen.getByRole("button", { name: /目录/ }));
    expect(screen.getByRole("tab", { name: /人物/ }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("苏眉")).toBeInTheDocument();
  });

  it("related-unit chip in archive page inter-jumps to the unit detail page in panel", async () => {
    const stores = await makeStores();
    renderPanel(stores);
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: /人物/ }));
    await user.click(screen.getByRole("button", { name: /林夏/ }));
    // 关联单元 chip（leaf 绑定派生：c-1 出场于 u1）→ 面板内跳单元详情
    await user.click(await screen.findByRole("button", { name: /第一章 · 雾起/ }));
    expect(await screen.findByText("意图 · intent")).toBeInTheDocument();
  });

  it("outline parent row toggles children; scene leaf row opens unit detail (leaf + paragraphs + jumps)", async () => {
    const stores = await makeStores();
    const { onSelectOutlineUnit, onOpenChapter } = renderPanel(stores);
    const user = userEvent.setup();
    // 初始展开（默认全展开？依赖 store 初始态）：先确认 leaf 行可见
    expect(screen.getByRole("button", { name: /第一章 · 雾起/ })).toBeInTheDocument();
    // 父级行点击 = 收起子层级
    await user.click(screen.getByRole("button", { name: /第一幕 · 旧港/ }));
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /第一章 · 雾起/ })).not.toBeInTheDocument();
    });
    // 父级行再点 = 展开
    await user.click(screen.getByRole("button", { name: /第一幕 · 旧港/ }));
    expect(screen.getByRole("button", { name: /第一章 · 雾起/ })).toBeInTheDocument();
    // leaf（场景）行点击 = 进单元详情页：意图/梗概 + leaf + 段落 + 跳转钮
    await user.click(screen.getByRole("button", { name: /第一章 · 雾起/ }));
    expect(await screen.findByText("意图 · intent")).toBeInTheDocument();
    expect(screen.getByText("梗概 · synopsis")).toBeInTheDocument();
    expect(screen.getByText("场景计划 · leaf")).toBeInTheDocument();
    expect(screen.getByText(/雾从旧船坞漫上来/)).toBeInTheDocument();
    expect(screen.getByText("P1")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /查看单元详情/ }));
    expect(onSelectOutlineUnit).toHaveBeenCalledWith("u1");
    await user.click(screen.getByRole("button", { name: /在正文中查看/ }));
    expect(onOpenChapter).toHaveBeenCalledWith("ch-1");
  });

  it("manuscript chapter row opens chapter detail (paragraphs + related scene chip + 在正文中查看)", async () => {
    const stores = await makeStores();
    const { onOpenChapter } = renderPanel(stores);
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: /正文/ }));
    expect(screen.getByText("第一卷 · 旧港潮声")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /雾起/ }));
    // 章详情：段落行 P1 + 关联场景 chip（面板内互跳）+ 在正文中查看
    expect(screen.getByText(/雾从旧船坞漫上来/)).toBeInTheDocument();
    expect(screen.getByText("P1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /在正文中查看/ })).toBeInTheDocument();
    // 段落行点击 → 跳内容视图正文
    fireEvent.click(screen.getByText(/雾从旧船坞漫上来/).closest("[data-dir-paragraph]") as HTMLElement);
    expect(onOpenChapter).toHaveBeenCalledWith("ch-1");
    // 关联场景 chip → 面板内跳单元详情
    await user.click(screen.getByRole("button", { name: /第一章 · 雾起/ }));
    expect(await screen.findByText("意图 · intent")).toBeInTheDocument();
  });

  it("locate() opens the detail page directly and scrolls (paragraph → chapter page + row)", async () => {
    const stores = await makeStores();
    const { dirStore } = renderPanel(stores);
    // 初始在大纲 tab；locate 地点档案 → 直达详情页 + scrollIntoView 标题行
    dirStore.locate({ kind: "location", id: "l-1" });
    expect(await screen.findByText("废弃的修船坞")).toBeInTheDocument();
    await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled());
    // locate 段落 → 章详情页 + 段落行定位
    dirStore.locate({ kind: "chapter", id: "ch-1", paragraphId: "p-1" });
    expect(await screen.findByText(/雾从旧船坞漫上来/)).toBeInTheDocument();
  });

  it("directory rows emit reference drag payload on dragstart (custom MIME)", async () => {
    const stores = await makeStores();
    renderPanel(stores);
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: /人物/ }));
    const dt = dataTransferStub();
    fireEvent.dragStart(screen.getByRole("button", { name: /林夏/ }), { dataTransfer: dt });
    expect(dt.types).toContain(REFERENCE_DND_MIME);
    expect(JSON.parse(dt.getData(REFERENCE_DND_MIME))).toEqual({
      kind: "character",
      id: "c-1",
      label: "林夏",
    });
    // 章详情段落行同样可拖（paragraph 引用载荷）
    await user.click(screen.getByRole("tab", { name: /正文/ }));
    await user.click(screen.getByRole("button", { name: /雾起/ }));
    const para = screen.getByText(/雾从旧船坞漫上来/).closest("[data-dir-paragraph]") as HTMLElement;
    const dt2 = dataTransferStub();
    fireEvent.dragStart(para, { dataTransfer: dt2 });
    expect(JSON.parse(dt2.getData(REFERENCE_DND_MIME))).toEqual({
      kind: "paragraph",
      id: "p-1",
      label: "段 1 · 雾起",
    });
  });
});
