/**
 * approvalEntityResolver 单测：kind 分支、辅助函数（归一化/目标提取/失效判断）。
 */
import { describe, expect, it, vi } from "vitest";
import {
  createApprovalEntityResolver,
  extractApprovalTargets,
  isApprovalStale,
  normalizeApprovalKind,
} from "../../../src/domains/approval/approvalEntityResolver.js";
import type { ManuscriptStructureStore } from "../../../src/domains/novel/manuscript/store/ManuscriptStructureStore.js";

function manuscriptStub(overrides?: object): ManuscriptStructureStore {
  return {
    getSnapshot: () => ({
      phase: "ready",
      workspaceId: "w1",
      volumes: [
        { volumeId: "v-1", title: "第一卷" },
      ],
      chapters: [
        {
          chapterId: "ch-1",
          title: "第一章",
          volumeId: "v-1",
          blocks: [
            { blockId: "p-1", text: "正文内容", digest: "d1", textLength: 4 },
            { blockId: "p-2", text: "", digest: "d2", textLength: 0 },
          ],
        },
      ],
      ...(overrides ?? {}),
    }),
  } as unknown as ManuscriptStructureStore;
}

function apiStub(): object {
  return {
    novel: {
      characters: {
        get: vi.fn(async () => ({
          character: {
            id: "c-1",
            name: "林夏",
            aliases: ["夏"],
            summary: "简介",
            initialState: "初始",
            authorNotes: "注记",
          },
        })),
      },
      locations: {
        get: vi.fn(async () => ({
          location: {
            id: "l-1",
            name: "旧船坞",
            aliases: [],
            summary: "地点简介",
            authorNotes: undefined,
          },
        })),
      },
      outline: {
        getStoryUnit: vi.fn(async () => ({
          unit: {
            id: "u-1",
            title: "追踪错误目标",
            intent: "意图",
            synopsis: "提要",
            scope: "scene",
            planningStatus: "outlined",
            realizationStatus: "in-progress",
            parentId: "u-0",
            orderKey: "0003",
          },
        })),
      },
      paragraphs: {
        get: vi.fn(async () => ({
          paragraph: {
            id: "p-2",
            storyUnitId: "u-1",
            orderKey: "0001",
            text: "正文（API 补）",
          },
        })),
      },
    },
  };
}

describe("normalizeApprovalKind", () => {
  it("maps outline to story_unit and passes through the rest", () => {
    expect(normalizeApprovalKind("outline")).toBe("story_unit");
    expect(normalizeApprovalKind("character")).toBe("character");
    expect(normalizeApprovalKind("location")).toBe("location");
    expect(normalizeApprovalKind("story_unit")).toBe("story_unit");
    expect(normalizeApprovalKind("volume")).toBe("volume");
    expect(normalizeApprovalKind("chapter")).toBe("chapter");
    expect(normalizeApprovalKind("paragraph")).toBe("paragraph");
    expect(normalizeApprovalKind("unknown")).toBeUndefined();
  });
});

describe("extractApprovalTargets", () => {
  it("extracts delete targets with kind from each value", () => {
    const result = extractApprovalTargets(
      "NovelDelete",
      "delete",
      {
        baseRevision: "rev-1",
        values: [
          { kind: "character", id: "c-1" },
          { kind: "outline", id: "u-1" },
        ],
      },
    );
    expect(result?.targets).toEqual([
      { kind: "character", id: "c-1" },
      { kind: "outline", id: "u-1" },
    ]);
    expect(result?.patches.size).toBe(0);
  });

  it("extracts edit targets with kind from tool name and patches", () => {
    const result = extractApprovalTargets(
      "NovelCharacterEdit",
      "edit",
      {
        baseRevision: "rev-1",
        values: [
          { id: "c-1", value: { name: "林夏", summary: "新简介" } },
        ],
      },
    );
    expect(result?.targets).toEqual([{ kind: "character", id: "c-1" }]);
    expect(result?.patches.get("c-1")).toEqual({
      name: "林夏",
      summary: "新简介",
    });
  });

  it("returns undefined for add / unknown op / non-object args", () => {
    expect(
      extractApprovalTargets("NovelCharacterWrite", "add", { values: [] }),
    ).toBeUndefined();
    expect(
      extractApprovalTargets("NovelDelete", "delete", "not-object"),
    ).toBeUndefined();
    expect(
      extractApprovalTargets("UnknownEdit", "edit", { values: [] }),
    ).toBeUndefined();
  });
});

describe("isApprovalStale", () => {
  it("flags stale when baseRevision differs from sourceRevision", () => {
    expect(
      isApprovalStale({ baseRevision: "rev-1" }, "rev-2"),
    ).toBe(true);
    expect(isApprovalStale({ baseRevision: "rev-1" }, "rev-1")).toBe(false);
    expect(isApprovalStale({ baseRevision: "rev-1" }, undefined)).toBe(false);
    expect(isApprovalStale(undefined, "rev-2")).toBe(false);
  });
});

describe("createApprovalEntityResolver", () => {
  it("resolves a character by id", async () => {
    const api = apiStub();
    const resolver = createApprovalEntityResolver({
      api: api as never,
      manuscript: manuscriptStub(),
    });
    const resolved = await resolver({ kind: "character", id: "c-1" });
    expect(resolved?.kind).toBe("character");
    expect(resolved?.fields.name).toBe("林夏");
    expect(resolved?.fields.aliases).toEqual(["夏"]);
    expect(resolved?.fields.summary).toBe("简介");
  });

  it("resolves a location by id", async () => {
    const api = apiStub();
    const resolver = createApprovalEntityResolver({
      api: api as never,
      manuscript: manuscriptStub(),
    });
    const resolved = await resolver({ kind: "location", id: "l-1" });
    expect(resolved?.fields.name).toBe("旧船坞");
    expect(resolved?.fields.authorNotes).toBeUndefined();
  });

  it("normalizes outline kind and resolves a story unit", async () => {
    const api = apiStub();
    const resolver = createApprovalEntityResolver({
      api: api as never,
      manuscript: manuscriptStub(),
    });
    const resolved = await resolver({ kind: "outline", id: "u-1" });
    expect(resolved?.kind).toBe("story_unit");
    expect(resolved?.fields.title).toBe("追踪错误目标");
    expect(resolved?.fields.planningStatus).toBe("outlined");
  });

  it("resolves volume and chapter from the manuscript store", async () => {
    const api = apiStub();
    const resolver = createApprovalEntityResolver({
      api: api as never,
      manuscript: manuscriptStub(),
    });
    const volume = await resolver({ kind: "volume", id: "v-1" });
    expect(volume?.fields.title).toBe("第一卷");
    const chapter = await resolver({ kind: "chapter", id: "ch-1" });
    expect(chapter?.fields.title).toBe("第一章");
    expect(await resolver({ kind: "chapter", id: "missing" })).toBeUndefined();
  });

  it("resolves a paragraph with loaded text from the block", async () => {
    const api = apiStub();
    const resolver = createApprovalEntityResolver({
      api: api as never,
      manuscript: manuscriptStub(),
    });
    const resolved = await resolver({ kind: "paragraph", id: "p-1" });
    expect(resolved?.fields.text).toBe("正文内容");
  });

  it("fills empty paragraph text via the API", async () => {
    const api = apiStub();
    const resolver = createApprovalEntityResolver({
      api: api as never,
      manuscript: manuscriptStub(),
    });
    const resolved = await resolver({ kind: "paragraph", id: "p-2" });
    expect(resolved?.fields.text).toBe("正文（API 补）");
    expect(resolved?.fields.storyUnitId).toBe("u-1");
  });

  it("returns undefined when both block and API are missing", async () => {
    const api = {
      novel: {
        paragraphs: { get: vi.fn(async () => ({ paragraph: undefined })) },
      },
    };
    const resolver = createApprovalEntityResolver({
      api: api as never,
      manuscript: manuscriptStub(),
    });
    expect(
      await resolver({ kind: "paragraph", id: "missing" }),
    ).toBeUndefined();
  });

  it("returns undefined on resolution error and unknown kind", async () => {
    const failingApi = {
      novel: {
        characters: {
          get: vi.fn(async () => {
            throw new Error("boom");
          }),
        },
      },
    };
    const resolver = createApprovalEntityResolver({
      api: failingApi as never,
      manuscript: manuscriptStub(),
    });
    expect(await resolver({ kind: "character", id: "c-1" })).toBeUndefined();
    expect(await resolver({ kind: "unknown", id: "x" })).toBeUndefined();
  });
});
