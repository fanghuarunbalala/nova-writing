/**
 * approvalEntityResolver（lite）单测：目标提取（add/edit/delete）、实体内容解析 diff、
 * 乐观锁 stale 判定（baseRevision vs entityVersion）、解析失败降级。
 */
import { describe, expect, it, vi } from "vitest";
import type { NovelApiClient } from "@novel/core";
import {
  createApprovalEntityResolver,
  extractApprovalTargets,
} from "../../../src/domains/approval/approvalEntityResolver.js";

function buildApi(overrides: Partial<NovelApiClient["novel"]> = {}): NovelApiClient {
  return {
    conversations: {} as never,
    approvals: {} as never,
    novel: {
      overview: { get: vi.fn() },
      outline: {
        get: vi.fn(async () => ({
          outline: { id: "o1", novelId: "n1" },
          units: [],
        })),
        getStoryUnit: vi.fn(),
      },
      characters: { list: vi.fn(), get: vi.fn() },
      locations: { list: vi.fn(), get: vi.fn() },
      paragraphs: { list: vi.fn(), get: vi.fn() },
      publication: { get: vi.fn() },
      mutate: vi.fn(),
      ...overrides,
    },
  } as unknown as NovelApiClient;
}

function characterEntity(overrides: Record<string, unknown> = {}) {
  return {
    id: "c-1",
    entityVersion: 2,
    createdAt: "2026-08-05T00:00:00.000Z",
    updatedAt: "2026-08-05T00:00:00.000Z",
    name: "林夏",
    aliases: ["夏"],
    summary: "旧简介",
    authorNotes: "",
    ...overrides,
  };
}

describe("extractApprovalTargets", () => {
  it("extracts add targets from write values", () => {
    const result = extractApprovalTargets("CharacterWrite", "add", {
      values: [{ name: "林夏", aliases: ["夏"] }],
    });
    expect(result?.targets).toEqual([
      {
        kind: "character",
        id: "add-character-0",
        op: "add",
        value: { name: "林夏", aliases: ["夏"] },
      },
    ]);
  });

  it("extracts edit targets with patch and baseRevision", () => {
    const result = extractApprovalTargets("CharacterEdit", "edit", {
      values: [{ characterId: "c-1", baseRevision: 3, patch: { summary: "新简介" } }],
    });
    expect(result?.targets[0]).toMatchObject({
      kind: "character",
      id: "c-1",
      op: "edit",
      baseRevision: 3,
    });
    expect(result?.targets[0].value).toEqual({ summary: "新简介" });
  });

  it("extracts delete targets with kind and baseRevision from each value", () => {
    const result = extractApprovalTargets("NovelDelete", "delete", {
      values: [{ kind: "character", id: "c-1", baseRevision: 2 }],
    });
    expect(result?.targets).toEqual([
      { kind: "character", id: "c-1", op: "delete", baseRevision: 2 },
    ]);
  });

  it("returns undefined for unknown op / non-object args / missing fields", () => {
    expect(extractApprovalTargets("CharacterWrite", "unknown", { values: [] })).toBeUndefined();
    expect(extractApprovalTargets("NovelDelete", "delete", "not-object")).toBeUndefined();
    expect(
      extractApprovalTargets("NovelDelete", "delete", { values: [{ kind: "character" }] }),
    ).toBeUndefined();
  });
});

describe("createApprovalEntityResolver", () => {
  it("resolves character add as all-add fields without stale", async () => {
    const resolver = createApprovalEntityResolver({ api: buildApi() });
    const resolved = await resolver({
      kind: "character",
      id: "add-character-0",
      op: "add",
      value: { name: "林夏", aliases: ["夏"] },
    });
    expect(resolved?.op).toBe("add");
    expect(resolved?.stale).toBe(false);
    expect(resolved?.fields.every((line) => line.state === "add")).toBe(true);
    expect(
      resolved?.fields.some((line) => line.field === "name" && line.new === "林夏"),
    ).toBe(true);
  });

  it("resolves character edit against the current entity and flags version mismatch", async () => {
    const api = buildApi({
      characters: {
        list: vi.fn(),
        get: vi.fn(async () => characterEntity({ entityVersion: 5 })),
      },
    });
    const resolver = createApprovalEntityResolver({ api });
    const resolved = await resolver({
      kind: "character",
      id: "c-1",
      op: "edit",
      value: { summary: "新简介" },
      baseRevision: 3,
    });
    expect(resolved?.stale).toBe(true);
    expect(
      resolved?.fields.some(
        (line) =>
          line.field === "summary" &&
          line.state === "edit" &&
          line.old === "旧简介" &&
          line.new === "新简介",
      ),
    ).toBe(true);
    const fresh = await resolver({
      kind: "character",
      id: "c-1",
      op: "edit",
      value: { summary: "新简介" },
      baseRevision: 5,
    });
    expect(fresh?.stale).toBe(false);
  });

  it("resolves character delete as all-delete fields", async () => {
    const api = buildApi({
      characters: {
        list: vi.fn(),
        get: vi.fn(async () => characterEntity()),
      },
    });
    const resolver = createApprovalEntityResolver({ api });
    const resolved = await resolver({ kind: "character", id: "c-1", op: "delete" });
    expect(resolved?.fields.every((line) => line.state === "delete")).toBe(true);
  });

  it("resolves story_unit edit via outline with tree context", async () => {
    const api = buildApi({
      outline: {
        get: vi.fn(async () => ({
          outline: { id: "o1", novelId: "n1" },
          units: [
            { id: "arc-1", title: "灯塔调查线", scope: "arc", planningStatus: "ready" },
            { id: "u-1", parentId: "arc-1", title: "追踪错误目标", scope: "scene", planningStatus: "outlined" },
          ],
        })),
        getStoryUnit: vi.fn(),
      },
    });
    const resolver = createApprovalEntityResolver({ api });
    const resolved = await resolver({
      kind: "story_unit",
      id: "u-1",
      op: "edit",
      value: { realizationStatus: "in-progress" },
      baseRevision: 1,
    });
    expect(resolved?.context?.type).toBe("tree");
    expect(
      resolved?.fields.some(
        (line) => line.field === "realizationStatus" && line.state === "edit",
      ),
    ).toBe(true);
  });

  it("returns undefined on resolution error and unknown kind", async () => {
    const failing = buildApi({
      characters: {
        list: vi.fn(),
        get: vi.fn(async () => {
          throw new Error("boom");
        }),
      },
    });
    const resolver = createApprovalEntityResolver({ api: failing });
    expect(await resolver({ kind: "character", id: "c-1", op: "delete" })).toBeUndefined();
    expect(await resolver({ kind: "unknown", id: "x", op: "edit" })).toBeUndefined();
  });
});
