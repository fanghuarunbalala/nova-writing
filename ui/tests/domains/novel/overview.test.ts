/**
 * NovelOverviewStore 契约测试。
 *
 * 适配说明：core overview 精简为 { novelId, title, counts(storyUnits/characters/
 * locations/paragraphs) }，无 scope/sourceRevision；store 中 volumeCount/
 * chapterCount 恒 0（等 publication 计数落地）。
 */
import { describe, expect, it, vi } from "vitest";
import type { NovelApiClient, NovelOverview } from "@novel/core";
import { NovelOverviewStore } from "../../../src/domains/novel/overview/NovelOverviewStore.js";

const overview: NovelOverview = {
  novelId: "novel_1",
  title: "雾港",
  counts: { storyUnits: 12, characters: 3, locations: 2, paragraphs: 9 },
};

function buildApi(overrides: Partial<NovelApiClient["novel"]["overview"]> = {}): NovelApiClient {
  return {
    conversations: {} as never,
    novel: {
      overview: {
        get: vi.fn(async () => overview),
        ...overrides,
      },
      outline: {} as never,
      characters: {} as never,
      locations: {} as never,
      paragraphs: {} as never,
    },
  } as unknown as NovelApiClient;
}

describe("NovelOverviewStore", () => {
  it("starts idle", () => {
    const store = new NovelOverviewStore({ api: buildApi() });
    expect(store.getSnapshot().phase).toBe("idle");
  });

  it("loadWorkspace maps the core overview into the domain snapshot", async () => {
    const api = buildApi();
    const store = new NovelOverviewStore({ api });
    await store.loadWorkspace("w1");
    const snapshot = store.getSnapshot();
    expect(api.novel.overview.get).toHaveBeenCalled();
    expect(snapshot.phase).toBe("ready");
    expect(snapshot.workspaceId).toBe("w1");
    expect(snapshot.novelId).toBe("novel_1");
    expect(snapshot.label).toBe("雾港");
    expect(snapshot.counts).toEqual({
      storyUnitCount: 12,
      characterCount: 3,
      locationCount: 2,
      volumeCount: 0,
      chapterCount: 0,
      paragraphCount: 9,
    });
  });

  it("records a retryable error on failure", async () => {
    const api = buildApi({
      get: vi.fn(async () => {
        throw new Error("down");
      }),
    });
    const store = new NovelOverviewStore({ api });
    await store.loadWorkspace("w1");
    expect(store.getSnapshot().phase).toBe("error");
    expect(store.getSnapshot().error?.code).toBe("novel-load-failed");
    expect(store.getSnapshot().error?.retryable).toBe(true);
  });

  it("invalidate reloads the current workspace", async () => {
    const get = vi.fn(async () => overview);
    const api = buildApi({ get });
    const store = new NovelOverviewStore({ api });
    await store.loadWorkspace("w1");
    await store.invalidate();
    expect(get).toHaveBeenCalledTimes(2);
  });
});
