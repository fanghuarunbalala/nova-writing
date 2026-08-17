/**
 * character 子域测试。
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Character, NovelApiClient } from "@novel/core";
import { CharacterStore } from "../../../src/domains/novel/character/store/CharacterStore.js";
import { CharacterGrid } from "../../../src/domains/novel/character/components/CharacterGrid.js";
import { CharacterDetailPanel } from "../../../src/domains/novel/character/components/CharacterDetailPanel.js";

const character: Character = {
  id: "char-linxia",
  entityVersion: 3,
  createdAt: "2026-08-05T00:00:00.000Z",
  updatedAt: "2026-08-05T00:00:00.000Z",
  name: "林夏",
  aliases: ["女主"],
  summary: "在旧船坞长大的少女",
  authorNotes: "核心弧光：学会告别",
};

function buildApi(overrides: Partial<NovelApiClient["novel"]["characters"]> = {}): NovelApiClient {
  return {
    conversations: {} as never,
    novel: {
      overview: {} as never,
      outline: {} as never,
      locations: {} as never,
      paragraphs: {} as never,
      publication: {} as never,
      // 新 core 契约：list/get 直接返回实体数组/实体（无 schemaVersion/scope 包装）
      characters: {
        list: vi.fn(async () => [character]),
        get: vi.fn(async () => character),
        ...overrides,
      },
    },
  } as unknown as NovelApiClient;
}

describe("CharacterStore", () => {
  it("loads character summaries", async () => {
    const api = buildApi();
    const store = new CharacterStore({ api });
    await store.loadWorkspace("w1");
    const snapshot = store.getSnapshot();
    expect(snapshot.phase).toBe("ready");
    expect(snapshot.characters[0]).toMatchObject({
      characterId: "char-linxia",
      name: "林夏",
      role: "女主",
      note: "在旧船坞长大的少女",
      avatarText: "林",
    });
  });

  it("loads and caches details", async () => {
    const api = buildApi();
    const store = new CharacterStore({ api });
    await store.loadWorkspace("w1");
    await store.loadDetail("char-linxia");
    const detail = store.getSnapshot().detailCache.get("char-linxia");
    expect(detail?.profile).toBe("核心弧光：学会告别");
    expect(detail?.version).toBe(3);
    expect(api.novel.characters.get).toHaveBeenCalledTimes(1);
    await store.loadDetail("char-linxia");
    expect(api.novel.characters.get).toHaveBeenCalledTimes(1);
  });

  it("tracks selection and records load errors", async () => {
    const store = new CharacterStore({ api: buildApi() });
    await store.loadWorkspace("w1");
    store.selectCharacter("char-linxia");
    expect(store.getSnapshot().selectedId).toBe("char-linxia");
    const failing = new CharacterStore({
      api: buildApi({
        list: vi.fn(async () => {
          throw new Error("down");
        }),
      }),
    });
    await failing.loadWorkspace("w1");
    expect(failing.getSnapshot().phase).toBe("error");
  });
});

describe("character components", () => {
  it("renders a grid and fires selection", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <CharacterGrid
        workspaceId="w1"
        characters={[
          { characterId: "char-linxia", avatarText: "林", name: "林夏", role: "女主", note: "在旧船坞长大", relatedUnits: [] },
        ]}
        onSelect={onSelect}
      />,
    );
    await user.click(screen.getByText("林夏"));
    expect(onSelect).toHaveBeenCalledWith("char-linxia");
  });

  it("renders detail archive cards and loading placeholder", () => {
    render(<CharacterDetailPanel workspaceId="w1" characterId="char-linxia" />);
    expect(screen.getByText(/加载角色详情/)).toBeInTheDocument();
    render(
      <CharacterDetailPanel
        workspaceId="w1"
        characterId="char-linxia"
        detail={{
          characterId: "char-linxia",
          avatarText: "林",
          name: "林夏",
          role: "女主",
          summary: "旧船坞长大的孤女",
          initialState: "佩着母亲留下的铜符",
          profile: "学会告别",
          version: 3,
          relatedUnits: [],
        }}
      />,
    );
    // PM-1：kicker（角色定位 · vN）。
    expect(screen.getByText("女主 · v3")).toBeInTheDocument();
    // PM-2：卡片顺序 = 简介 → 初始状态 → 作者备注（楷体）→ 关联单元（空态）。
    expect(screen.getByText("简介")).toBeInTheDocument();
    expect(screen.getByText("旧船坞长大的孤女")).toBeInTheDocument();
    expect(screen.getByText("初始状态")).toBeInTheDocument();
    expect(screen.getByText("佩着母亲留下的铜符")).toBeInTheDocument();
    expect(screen.getByText("作者备注")).toBeInTheDocument();
    expect(screen.getByText("学会告别")).toBeInTheDocument();
    expect(screen.getByText("尚未关联")).toBeInTheDocument();
  });
});
