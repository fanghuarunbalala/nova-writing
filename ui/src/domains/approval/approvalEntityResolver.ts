/**
 * 审批目标实体解析器（approval entity resolver）
 *
 * 把删除/编辑审批中 values[] 里的目标 id 解析成当前 canonical 实体内容，
 * 供审批详情展示「变更对象」。删除/编辑作用于 canonical，审批时未执行，
 * 按 id 查当前 canonical 即为删除前/编辑前内容。同时提供
 * extractApprovalTargets / isApprovalStale：前者从工具参数提取目标与编辑
 * patch，后者对比 arguments.baseRevision 与当前 sourceRevision 判断审批
 * 是否已过期失效（基于过期数据执行必失败）。
 *
 * Resolves delete/edit approval target ids to the current canonical entity
 * content for the approval detail. Also extracts targets/patches from tool
 * arguments and compares baseRevision against sourceRevision to flag stale
 * approvals.
 */
import {
  canonicalNovelQueryScope,
  type CharacterId,
  type LocationId,
  type JsonObject,
  type JsonValue,
  type NovelApiClient,
  type ParagraphId,
  type StoryUnitId,
} from "@novel/core";
import type { ManuscriptStructureStore } from "../novel/manuscript/store/ManuscriptStructureStore.js";

export type ApprovalEntityKind =
  | "character"
  | "location"
  | "story_unit"
  | "chapter"
  | "volume"
  | "paragraph";

export interface ApprovalEntityTarget {
  readonly kind: string;
  readonly id: string;
}

export interface ResolvedEntityContent {
  readonly kind: ApprovalEntityKind;
  readonly id: string;
  /** 实体当前字段（JsonObject），直接用 ParameterView 渲染。 */
  readonly fields: JsonObject;
}

export type ApprovalEntityResolver = (
  target: ApprovalEntityTarget,
) => Promise<ResolvedEntityContent | undefined>;

export interface ApprovalEntityResolverDeps {
  readonly api: NovelApiClient;
  readonly manuscript: ManuscriptStructureStore;
}

/** Edit 工具名 → 实体 kind。Edit tool name → entity kind. */
const EDIT_KIND_BY_TOOL_NAME: Readonly<Record<string, string>> = {
  NovelOutlineEdit: "outline",
  NovelCharacterEdit: "character",
  NovelLocationEdit: "location",
  NovelParagraphEdit: "paragraph",
  NovelVolumeEdit: "volume",
  NovelChapterEdit: "chapter",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 把审批 kind 归一化为可解析的实体 kind（outline → story_unit）。 */
export function normalizeApprovalKind(
  kind: string,
): ApprovalEntityKind | undefined {
  if (kind === "outline") return "story_unit";
  if (
    kind === "character" ||
    kind === "location" ||
    kind === "story_unit" ||
    kind === "chapter" ||
    kind === "volume" ||
    kind === "paragraph"
  ) {
    return kind;
  }
  return undefined;
}

export interface ApprovalTargets {
  readonly targets: readonly ApprovalEntityTarget[];
  /** 编辑 patch（id → value 对象）；删除为空。Edit patches by target id. */
  readonly patches: ReadonlyMap<string, JsonObject>;
}

/** 从工具参数提取删除/编辑目标与 patch；add/未知 op/无 values 返回 undefined。 */
export function extractApprovalTargets(
  toolName: string,
  op: "add" | "edit" | "delete" | undefined,
  args: JsonValue | undefined,
): ApprovalTargets | undefined {
  if (op !== "edit" && op !== "delete") return undefined;
  if (args === undefined || !isRecord(args)) return undefined;
  const values = args.values;
  if (!Array.isArray(values)) return undefined;

  if (op === "delete") {
    const targets: ApprovalEntityTarget[] = [];
    for (const item of values) {
      if (
        isRecord(item) &&
        typeof item.id === "string" &&
        typeof item.kind === "string" &&
        normalizeApprovalKind(item.kind) !== undefined
      ) {
        targets.push({ kind: item.kind, id: item.id });
      }
    }
    return targets.length === 0
      ? undefined
      : Object.freeze({ targets: Object.freeze(targets), patches: new Map() });
  }

  const kind = EDIT_KIND_BY_TOOL_NAME[toolName];
  if (kind === undefined) return undefined;
  const targets: ApprovalEntityTarget[] = [];
  const patches = new Map<string, JsonObject>();
  for (const item of values) {
    if (!isRecord(item) || typeof item.id !== "string") continue;
    targets.push({ kind, id: item.id });
    if (isRecord(item.value)) patches.set(item.id, item.value as JsonObject);
  }
  return targets.length === 0
    ? undefined
    : Object.freeze({ targets: Object.freeze(targets), patches });
}

/** 对比 arguments.baseRevision 与当前 sourceRevision，不一致 → 已过期失效。 */
export function isApprovalStale(
  args: JsonValue | undefined,
  sourceRevision: string | undefined,
): boolean {
  if (sourceRevision === undefined || args === undefined || !isRecord(args)) {
    return false;
  }
  const base = args.baseRevision;
  return typeof base === "string" && base !== sourceRevision;
}

async function resolveCharacter(
  api: NovelApiClient,
  id: string,
): Promise<ResolvedEntityContent | undefined> {
  const result = await api.novel.characters.get(
    canonicalNovelQueryScope,
    id as CharacterId,
  );
  const character = result.character;
  if (character === undefined) return undefined;
  return {
    kind: "character",
    id,
    fields: {
      id,
      name: character.name,
      aliases: [...character.aliases],
      ...(character.summary === undefined ? {} : { summary: character.summary }),
      ...(character.initialState === undefined
        ? {}
        : { initialState: character.initialState }),
      ...(character.authorNotes === undefined
        ? {}
        : { authorNotes: character.authorNotes }),
    },
  };
}

async function resolveLocation(
  api: NovelApiClient,
  id: string,
): Promise<ResolvedEntityContent | undefined> {
  const result = await api.novel.locations.get(
    canonicalNovelQueryScope,
    id as LocationId,
  );
  const location = result.location;
  if (location === undefined) return undefined;
  return {
    kind: "location",
    id,
    fields: {
      id,
      name: location.name,
      aliases: [...location.aliases],
      ...(location.summary === undefined ? {} : { summary: location.summary }),
      ...(location.initialState === undefined
        ? {}
        : { initialState: location.initialState }),
      ...(location.authorNotes === undefined
        ? {}
        : { authorNotes: location.authorNotes }),
    },
  };
}

async function resolveStoryUnit(
  api: NovelApiClient,
  id: string,
): Promise<ResolvedEntityContent | undefined> {
  const result = await api.novel.outline.getStoryUnit(
    canonicalNovelQueryScope,
    id as StoryUnitId,
  );
  const unit = result.unit;
  if (unit === undefined) return undefined;
  return {
    kind: "story_unit",
    id,
    fields: {
      id,
      title: unit.title,
      ...(unit.intent === undefined ? {} : { intent: unit.intent }),
      ...(unit.synopsis === undefined ? {} : { synopsis: unit.synopsis }),
      ...(unit.scope === undefined ? {} : { scope: unit.scope }),
      planningStatus: unit.planningStatus,
      realizationStatus: unit.realizationStatus,
      ...(unit.parentId === undefined ? {} : { parentId: unit.parentId }),
      orderKey: unit.orderKey,
      ...(unit.blockState === undefined
        ? {}
        : { blockState: unit.blockState as unknown as JsonValue }),
      ...(unit.abandonment === undefined
        ? {}
        : { abandonment: unit.abandonment as unknown as JsonValue }),
    },
  };
}

function resolveVolume(
  manuscript: ManuscriptStructureStore,
  id: string,
): ResolvedEntityContent | undefined {
  const volume = manuscript
    .getSnapshot()
    .volumes.find((item) => item.volumeId === id);
  return volume === undefined
    ? undefined
    : { kind: "volume", id, fields: { id, title: volume.title } };
}

function resolveChapter(
  manuscript: ManuscriptStructureStore,
  id: string,
): ResolvedEntityContent | undefined {
  const chapter = manuscript
    .getSnapshot()
    .chapters.find((item) => item.chapterId === id);
  return chapter === undefined
    ? undefined
    : {
        kind: "chapter",
        id,
        fields: { id, title: chapter.title, volumeId: chapter.volumeId },
      };
}

async function resolveParagraph(
  api: NovelApiClient,
  manuscript: ManuscriptStructureStore,
  id: string,
): Promise<ResolvedEntityContent | undefined> {
  let block:
    | { readonly text: string; readonly storyUnitId?: string; readonly orderKey?: string }
    | undefined;
  for (const chapter of manuscript.getSnapshot().chapters) {
    const found = chapter.blocks.find((item) => item.blockId === id);
    if (found !== undefined) {
      block = { text: found.text };
      break;
    }
  }
  let text = block?.text ?? "";
  let storyUnitId: string | undefined;
  let orderKey: string | undefined;
  if (text === "") {
    try {
      const result = await api.novel.paragraphs.get(
        canonicalNovelQueryScope,
        id as ParagraphId,
      );
      const paragraph = result.readModel?.paragraph;
      if (paragraph !== undefined) {
        text = paragraph.text;
        storyUnitId = paragraph.storyUnitId;
        orderKey = paragraph.orderKey;
      }
    } catch {
      // 快照未加载正文且 API 失败 → 用块内已有字段兜底。
    }
  }
  if (block === undefined && text === "") return undefined;
  return {
    kind: "paragraph",
    id,
    fields: {
      id,
      ...(storyUnitId === undefined ? {} : { storyUnitId }),
      ...(orderKey === undefined ? {} : { orderKey }),
      text,
    },
  };
}

/** 从 API + manuscript store 构建解析器；解析失败一律返回 undefined。 */
export function createApprovalEntityResolver(
  deps: ApprovalEntityResolverDeps,
): ApprovalEntityResolver {
  const { api, manuscript } = deps;
  return async (target) => {
    const kind = normalizeApprovalKind(target.kind);
    if (kind === undefined) return undefined;
    try {
      switch (kind) {
        case "character":
          return await resolveCharacter(api, target.id);
        case "location":
          return await resolveLocation(api, target.id);
        case "story_unit":
          return await resolveStoryUnit(api, target.id);
        case "volume":
          return resolveVolume(manuscript, target.id);
        case "chapter":
          return resolveChapter(manuscript, target.id);
        case "paragraph":
          return await resolveParagraph(api, manuscript, target.id);
      }
    } catch {
      return undefined;
    }
  };
}
