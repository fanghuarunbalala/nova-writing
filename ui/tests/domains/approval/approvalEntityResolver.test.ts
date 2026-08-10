/**
 * approvalEntityResolver 单测：kind 分支、目标提取、失效判断、上下文与写作方案。
 */
import { describe, expect, it, vi } from "vitest";
import type { StoryOutlineTreeNode } from "../../../src/domains/novel/outline/projection/StoryOutlineTreeProjection.js";
import type { StoryOutlineTreeStore } from "../../../src/domains/novel/outline/store/StoryOutlineTreeStore.js";
import type { CharacterStore } from "../../../src/domains/novel/character/store/CharacterStore.js";
import type { LocationStore } from "../../../src/domains/novel/location/store/LocationStore.js";
import type { ManuscriptStructureStore } from "../../../src/domains/novel/manuscript/store/ManuscriptStructureStore.js";
import {
  createApprovalEntityResolver,
  extractApprovalTargets,
  isApprovalStale,
  normalizeApprovalKind,
} from "../../../src/domains/approval/approvalEntityResolver.js";

function outlineStub(tree: readonly StoryOutlineTreeNode[]): StoryOutlineTreeStore {
  return {
    getSnapshot: () => ({ tree }),
  } as unknown as StoryOutlineTreeStore;
}

function characterStoreStub(): CharacterStore {
  return {
    getSnapshot: () => ({
      characters: [{ characterId: "c-1", name: "林夏" }],
    }),
  } as unknown as CharacterStore;
}

function locationStoreStub(): LocationStore {
  return {
    getSnapshot: () => ({ locations: [{ locationId: "l-1", name: "旧船坞" }] }),
  } as unknown as LocationStore;
}

function manuscriptStub(): ManuscriptStructureStore {
  return {
    getSnapshot: () => ({
      volumes: [
        {
          volumeId: "v-1",
          title: "第一卷 · 雾港",
          chapters: [
            { chapterId: "ch-1", title: "第一章" },
            { chapterId: "ch-2", title: "第二章" },
          ],
        },
      ],
      chapters: [
        {
          chapterId: "ch-1",
          title: "第一章",
          volumeId: "v-1",
          blocks: [
            { blockId: "p-1", text: "段一" },
            { blockId: "p-2", text: "段二" },
            { blockId: "p-3", text: "段三" },
          ],
        },
      ],
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
          location: { id: "l-1", name: "旧船坞", aliases: [], summary: "地点简介" },
        })),
      },
      outline: {
        getStoryUnit: vi.fn(async () => ({
          unit: {
            id: "u-1",
            title: "追踪错误目标",
            intent: "意图",
            scope: "scene",
            planningStatus: "outlined",
            realizationStatus: "in-progress",
            orderKey: "0003",
          },
        })),
      },
      paragraphs: {
        get: vi.fn(async () => ({
          readModel: { paragraph: { id: "p-3", text: "段三（API 补）", storyUnitId: "u-1", orderKey: "0001" } },
        })),
      },
    },
  };
}

const TREE: readonly StoryOutlineTreeNode[] = [
  {
    unitId: "arc-1",
    label: "灯塔调查线",
    scope: "ARC",
    planM: 3,
    realNode: "in-progress",
    children: [
      { unitId: "u-1", label: "追踪错误目标", scope: "SCENE", planM: 2, realNode: "pending", children: [] },
      { unitId: "u-2", label: "发现货单", scope: "SCENE", planM: 1, realNode: "pending", children: [] },
    ],
  },
];

function makeResolver() {
  return createApprovalEntityResolver({
    api: apiStub() as never,
    manuscript: manuscriptStub(),
    outline: outlineStub(TREE),
    characters: characterStoreStub(),
    locations: locationStoreStub(),
  });
}

describe("normalizeApprovalKind", () => {
  it("maps outline to story_unit and passes through the rest", () => {
    expect(normalizeApprovalKind("outline")).toBe("story_unit");
    expect(normalizeApprovalKind("character")).toBe("character");
    expect(normalizeApprovalKind("location")).toBe("location");
    expect(normalizeApprovalKind("volume")).toBe("volume");
    expect(normalizeApprovalKind("chapter")).toBe("chapter");
    expect(normalizeApprovalKind("paragraph")).toBe("paragraph");
    expect(normalizeApprovalKind("unknown")).toBeUndefined();
  });
});

describe("extractApprovalTargets", () => {
  it("extracts add targets from write item fields", () => {
    const result = extractApprovalTargets(
      "NovelCharacterWrite",
      "add",
      { baseRevision: "r", values: [{ name: "林夏", aliases: ["夏"] }] },
    );
    expect(result?.targets).toEqual([
      { kind: "character", id: "#1", op: "add", value: { name: "林夏", aliases: ["夏"] } },
    ]);
  });

  it("extracts edit targets with patch value", () => {
    const result = extractApprovalTargets(
      "NovelCharacterEdit",
      "edit",
      { baseRevision: "r", values: [{ id: "c-1", value: { summary: "新简介" } }] },
    );
    expect(result?.targets[0]).toMatchObject({ kind: "character", id: "c-1", op: "edit" });
    expect(result?.targets[0].value).toEqual({ summary: "新简介" });
  });

  it("extracts delete targets with kind from each value", () => {
    const result = extractApprovalTargets(
      "NovelDelete",
      "delete",
      { baseRevision: "r", values: [{ kind: "character", id: "c-1" }] },
    );
    expect(result?.targets).toEqual([{ kind: "character", id: "c-1", op: "delete" }]);
  });

  it("returns undefined for unknown op / non-object args", () => {
    expect(extractApprovalTargets("NovelCharacterWrite", "unknown", { values: [] })).toBeUndefined();
    expect(extractApprovalTargets("NovelDelete", "delete", "not-object")).toBeUndefined();
  });
});

describe("isApprovalStale", () => {
  it("flags stale when baseRevision differs from sourceRevision", () => {
    expect(isApprovalStale({ baseRevision: "rev-1" }, "rev-2")).toBe(true);
    expect(isApprovalStale({ baseRevision: "rev-1" }, "rev-1")).toBe(false);
    expect(isApprovalStale({ baseRevision: "rev-1" }, undefined)).toBe(false);
    expect(isApprovalStale(undefined, "rev-2")).toBe(false);
  });
});

describe("createApprovalEntityResolver", () => {
  it("resolves character add as all-green fields", async () => {
    const resolved = await makeResolver()({ kind: "character", id: "#1", op: "add", value: { name: "林夏", aliases: ["夏"] } });
    expect(resolved?.op).toBe("add");
    expect(resolved?.fields.every((line) => line.state === "add")).toBe(true);
    expect(resolved?.fields.some((line) => line.field === "name" && line.new === "林夏")).toBe(true);
  });

  it("resolves character edit as ctx + edit fields", async () => {
    const resolved = await makeResolver()({ kind: "character", id: "c-1", op: "edit", value: { summary: "新简介" } });
    expect(resolved?.fields.some((line) => line.field === "summary" && line.state === "edit")).toBe(true);
    expect(resolved?.fields.some((line) => line.field === "name" && line.state === "ctx")).toBe(true);
  });

  it("resolves character delete as all-red fields", async () => {
    const resolved = await makeResolver()({ kind: "character", id: "c-1", op: "delete" });
    expect(resolved?.fields.every((line) => line.state === "delete")).toBe(true);
  });

  it("resolves location by id", async () => {
    const resolved = await makeResolver()({ kind: "location", id: "l-1", op: "edit", value: { summary: "新" } });
    expect(resolved?.fields.some((line) => line.field === "name" && line.state === "ctx")).toBe(true);
  });

  it("resolves story_unit add with tree context and leaf", async () => {
    const resolved = await makeResolver()({
      kind: "outline",
      id: "u-3",
      op: "add",
      value: { title: "新场景", parentId: "arc-1", scope: "scene", leaf: { settingMode: "located", time: { description: "傍晚" }, characters: [] } },
    });
    expect(resolved?.op).toBe("add");
    expect(resolved?.context?.type).toBe("tree");
    expect(resolved?.leaf?.some((line) => line.field === "settingMode" && line.new === "定点场景")).toBe(true);
  });

  it("resolves story_unit edit with tree context and current highlight", async () => {
    const resolved = await makeResolver()({ kind: "outline", id: "u-1", op: "edit", value: { realizationStatus: "in-progress" } });
    expect(resolved?.context?.type).toBe("tree");
    expect(resolved?.fields.some((line) => line.field === "realizationStatus" && line.state === "edit")).toBe(true);
  });

  it("resolves volume with list context", async () => {
    const resolved = await makeResolver()({ kind: "volume", id: "v-1", op: "edit", value: { title: "新标题" } });
    expect(resolved?.context?.type).toBe("list");
    expect(resolved?.fields.some((line) => line.field === "title" && line.state === "edit")).toBe(true);
  });

  it("resolves chapter with list context and paragraph content", async () => {
    const resolved = await makeResolver()({ kind: "chapter", id: "ch-1", op: "edit", value: { title: "新章名" } });
    expect(resolved?.context?.type).toBe("list");
    expect(resolved?.paragraphs?.some((line) => line.text === "段一")).toBe(true);
  });

  it("resolves paragraph edit with neighbor + old/new lines", async () => {
    const resolved = await makeResolver()({ kind: "paragraph", id: "p-2", op: "edit", value: { text: "段二（改）" } });
    expect(resolved?.paragraphs?.some((line) => line.state === "old")).toBe(true);
    expect(resolved?.paragraphs?.some((line) => line.state === "new" && line.text === "段二（改）")).toBe(true);
    expect(resolved?.paragraphs?.some((line) => line.state === "ctx")).toBe(true);
  });

  it("returns undefined on resolution error and unknown kind", async () => {
    const failing = createApprovalEntityResolver({
      api: { novel: { characters: { get: vi.fn(async () => { throw new Error("boom"); }) } } } as never,
      manuscript: manuscriptStub(),
      outline: outlineStub(TREE),
      characters: characterStoreStub(),
      locations: locationStoreStub(),
    });
    expect(await failing({ kind: "character", id: "c-1", op: "delete" })).toBeUndefined();
    expect(await failing({ kind: "unknown", id: "x", op: "edit" })).toBeUndefined();
  });
});
