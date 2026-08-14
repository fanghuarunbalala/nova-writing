/**
 * approvalEntityResolver（lite 版）
 *
 * 删除/编辑审批的目标实体内容解析器：经 api.novel.* 查询目标实体当前内容，
 * 产出 ApprovalEntityView 消费的 ResolvedEntityContent（字段 diff 行 + stale 判定）。
 *
 * 与旧版差异（裁剪）：
 * - stale 判定基于每实体乐观锁版本（target.baseRevision vs entity.entityVersion），
 *   不再依赖全局 sourceRevision（新版无此模型）；
 * - 深层上下文树（outline 树/卷章列表/相邻段落/leaf 写作方案）降级为不产出，
 *   ApprovalEntityView 无 context 输入时自动隐藏该区；
 * - add（写入）不查实体，直接由参数构建字段行。
 */

import type { NovelApiClient } from "@novel/core";
import type { JsonObject, JsonValue } from "./jsonTypes.js";
import {
  paramFieldRank,
  paramKeyLabel,
  paramValueLabel,
} from "./paramLabels.js";

/** 可解析的实体 kind */
export type ApprovalEntityKind =
  | "character"
  | "location"
  | "story_unit"
  | "chapter"
  | "volume"
  | "paragraph";

/** 字段行状态（add 绿 / edit 橙 / delete 红 / ctx 灰上下文） */
export type ApprovalFieldState = "add" | "edit" | "delete" | "ctx";

/** 字段 diff 行 */
export interface ApprovalFieldLine {
  readonly field: string;
  readonly label: string;
  readonly old?: string;
  readonly new?: string;
  readonly state: ApprovalFieldState;
}

/** 上下文树节点（lite 版不产出深层树，保留类型给 ApprovalEntityView） */
export interface ApprovalContextNode {
  readonly id: string;
  readonly label: string;
  readonly scope?: string;
  readonly status?: string;
  readonly state: "ctx" | "current" | "add" | "delete";
  readonly children?: readonly ApprovalContextNode[];
}

/** 段落行（lite 版不产出，保留类型给 ApprovalEntityView） */
export interface ApprovalParagraphLine {
  readonly text: string;
  readonly state: "ctx" | "old" | "new";
}

export type ApprovalContext =
  | { readonly type: "tree"; readonly nodes: readonly ApprovalContextNode[] }
  | {
      readonly type: "list";
      readonly nodes: readonly ApprovalContextNode[];
      readonly parent?: string;
    };

/** 审批目标（extractApprovalTargets 从 args 解析出） */
export interface ApprovalTarget {
  /** 实体 kind（character/location/story_unit/paragraph/volume/chapter） */
  readonly kind: string;
  readonly id: string;
  readonly op: "add" | "edit" | "delete";
  /** add: 写入项字段；edit: patch。 */
  readonly value?: JsonObject;
  /** edit/delete: 最近读到的版本（乐观锁 stale 判定） */
  readonly baseRevision?: number;
}

/** 解析出的目标集合（不可解析时 undefined → 面板走参数平铺展示） */
export interface ApprovalTargets {
  readonly targets: readonly ApprovalTarget[];
}

/** 实体解析结果 */
export interface ResolvedEntityContent {
  readonly kind: ApprovalEntityKind;
  readonly id: string;
  readonly name: string;
  readonly op: "add" | "edit" | "delete";
  readonly fields: readonly ApprovalFieldLine[];
  /** 乐观锁失效：目标 baseRevision 与实体当前 entityVersion 不一致 */
  readonly stale: boolean;
  readonly context?: ApprovalContext;
  /** 段落行（lite 版不产出） */
  readonly paragraphs?: readonly ApprovalParagraphLine[];
  /** 写作方案 leaf 行（lite 版不产出） */
  readonly leaf?: readonly ApprovalFieldLine[];
}

export type ApprovalEntityResolver = (
  target: ApprovalTarget,
) => Promise<ResolvedEntityContent | undefined>;

/** 工具名 → 实体 kind（新版工具命名：CharacterWrite/Edit/…） */
const KIND_BY_TOOL_NAME: Readonly<Record<string, string>> = {
  CharacterWrite: "character",
  CharacterEdit: "character",
  LocationWrite: "location",
  LocationEdit: "location",
  OutlineWrite: "story_unit",
  OutlineEdit: "story_unit",
  ParagraphWrite: "paragraph",
  ParagraphEdit: "paragraph",
};

/** 内部/结构性字段不展示（顺序由树/列表位置体现，id/baseRevision 无信息量）。 */
const SKIP_FIELDS: ReadonlySet<string> = new Set([
  "id",
  "baseRevision",
  "orderKey",
  "parentId",
  "entityVersion",
  "createdAt",
  "updatedAt",
  "outlineId",
  "publicationId",
  "schemaVersion",
  "novelId",
  "storyUnitId",
  "volumeId",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isPrimitive(value: JsonValue): boolean {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

/** 值格式化：枚举翻译、基本值数组顿号、嵌套对象紧凑 JSON。 */
function formatValue(field: string, value: JsonValue | undefined): string {
  if (value === undefined) return "—";
  if (value === null) return "空";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "string") return paramValueLabel(field, value) ?? value;
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "空";
    if (value.every(isPrimitive)) {
      return value
        .map((item) =>
          typeof item === "string"
            ? (paramValueLabel(field, item) ?? item)
            : String(item ?? "空"),
        )
        .join("、");
    }
    return JSON.stringify(value);
  }
  return JSON.stringify(value);
}

function fieldLabel(field: string): string {
  return paramKeyLabel(field) ?? field;
}

/** blockState/abandonment 提取原因行，避免整对象 JSON。 */
function formatFieldValue(field: string, value: JsonValue | undefined): string {
  if ((field === "blockState" || field === "abandonment") && isRecord(value)) {
    const reason =
      paramValueLabel("reasonCode", asString(value.reasonCode) ?? "") ??
      asString(value.reasonCode) ??
      "";
    const note = asString(value.note);
    const summary = [reason, note].filter(Boolean).join(" · ");
    return summary || (field === "blockState" ? "阻塞" : "废弃");
  }
  return formatValue(field, value);
}

function sortByRank(lines: readonly ApprovalFieldLine[]): ApprovalFieldLine[] {
  return [...lines].sort(
    (left, right) => paramFieldRank(left.field) - paramFieldRank(right.field),
  );
}

/** 从当前值与 patch 生成 diff 行。 */
function buildFields(
  current: JsonObject | undefined,
  patch: JsonObject | undefined,
  op: "add" | "edit" | "delete",
): ApprovalFieldLine[] {
  const lines: ApprovalFieldLine[] = [];
  if (op === "add") {
    for (const [field, value] of Object.entries(patch ?? {})) {
      if (SKIP_FIELDS.has(field)) continue;
      lines.push({ field, label: fieldLabel(field), new: formatFieldValue(field, value as JsonValue), state: "add" });
    }
    return sortByRank(lines);
  }
  if (op === "edit") {
    for (const [field, newValue] of Object.entries(patch ?? {})) {
      if (SKIP_FIELDS.has(field)) continue;
      lines.push({
        field,
        label: fieldLabel(field),
        old: formatFieldValue(field, current?.[field] as JsonValue | undefined),
        new: formatFieldValue(field, newValue as JsonValue),
        state: "edit",
      });
    }
    return sortByRank(lines);
  }
  for (const [field, value] of Object.entries(current ?? {})) {
    if (SKIP_FIELDS.has(field)) continue;
    lines.push({ field, label: fieldLabel(field), old: formatFieldValue(field, value as JsonValue), state: "delete" });
  }
  return sortByRank(lines);
}

/**
 * 从工具名 + 参数解析审批目标集合（新版 args 形状：Write=values[] 或单对象、
 * Edit=values[{<kind>Id, baseRevision, patch}] 或单对象、Delete=values[{kind,id,baseRevision}]）。
 * @param toolName 工具名
 * @param op 操作类型（add/edit/delete）
 * @param args 解析后的参数
 * @returns 目标集合（无法解析时 undefined）
 */
export function extractApprovalTargets(
  toolName: string,
  op: "add" | "edit" | "delete" | undefined,
  args: JsonValue | undefined,
): ApprovalTargets | undefined {
  if (args === undefined || op === undefined || !isRecord(args)) return undefined;

  // Delete：values[{kind, id, baseRevision}]
  if (op === "delete") {
    const values = Array.isArray(args.values) ? args.values : undefined;
    if (values === undefined) return undefined;
    const targets: ApprovalTarget[] = [];
    for (const value of values) {
      if (!isRecord(value)) continue;
      const kind = asString(value.kind);
      const id = asString(value.id);
      const baseRevision =
        typeof value.baseRevision === "number" ? value.baseRevision : undefined;
      if (kind === undefined || id === undefined) continue;
      targets.push({
        kind: normalizeApprovalKind(kind),
        id,
        op: "delete",
        baseRevision,
      });
    }
    return targets.length > 0 ? { targets } : undefined;
  }

  // Write：values[EntityInput] 或单对象（ParagraphWrite/OutlineWrite/PublicationWrite）
  if (op === "add") {
    const kind = KIND_BY_TOOL_NAME[toolName];
    if (kind === undefined) return undefined;
    const items = Array.isArray(args.values) ? args.values : [args];
    const targets: ApprovalTarget[] = [];
    for (const item of items) {
      if (!isRecord(item)) continue;
      targets.push({ kind, id: `add-${kind}-${targets.length}`, op: "add", value: item as JsonObject });
    }
    return targets.length > 0 ? { targets } : undefined;
  }

  // Edit：values[{<kind>Id, baseRevision, patch}] 或单对象
  const kind = KIND_BY_TOOL_NAME[toolName];
  if (kind === undefined) return undefined;
  const items = Array.isArray(args.values) ? args.values : [args];
  const idField = `${kind === "story_unit" ? "storyUnit" : kind}Id`;
  const targets: ApprovalTarget[] = [];
  for (const item of items) {
    if (!isRecord(item)) continue;
    const id = asString(item[idField]);
    const baseRevision =
      typeof item.baseRevision === "number" ? item.baseRevision : undefined;
    const patch = isRecord(item.patch) ? (item.patch as JsonObject) : undefined;
    if (id === undefined || patch === undefined) continue;
    targets.push({ kind, id, op: "edit", value: patch, baseRevision });
  }
  return targets.length > 0 ? { targets } : undefined;
}

/** kind 归一化（Delete 工具的 story_unit → story_unit 保持；kindId 域不变） */
function normalizeApprovalKind(kind: string): string {
  return kind;
}

/** 实体字段 → JSON 对象（供 buildFields 用） */
function entityToJsonObject(entity: unknown): JsonObject {
  return (isRecord(entity) ? entity : {}) as JsonObject;
}

/** 大纲祖先链 → context tree（根→目标；目标标 current，祖先标 ctx） */
function buildOutlineContext(
  units: readonly unknown[],
  targetId: string,
): ApprovalContext | undefined {
  const find = (parentId: unknown, trail: unknown[]): unknown[] | undefined => {
    const children = units.filter((u) => isRecord(u) && (u.parentId ?? undefined) === parentId);
    for (const child of children) {
      const next = [...trail, child];
      if ((child as Record<string, unknown>).id === targetId) return next;
      const found = find((child as Record<string, unknown>).id, next);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  const trail = find(undefined, []);
  if (trail === undefined) return undefined;
  const toNode = (unit: Record<string, unknown>, state: "ctx" | "current"): ApprovalContextNode => {
    const scope = asString(unit.scope);
    const planning = asString(unit.planningStatus);
    return {
      id: asString(unit.id) ?? "",
      label: asString(unit.title) ?? asString(unit.id) ?? "",
      ...(scope !== undefined ? { scope } : {}),
      ...(planning !== undefined ? { status: planning } : {}),
      state,
    };
  };
  const nodes: ApprovalContextNode[] = [];
  for (let index = 0; index < trail.length; index++) {
    const unit = trail[index] as Record<string, unknown>;
    nodes.push(toNode(unit, index === trail.length - 1 ? "current" : "ctx"));
  }
  return { type: "tree", nodes };
}

/** 段落相邻行（前一条/目标/后一条） */
function buildParagraphContext(
  paragraphs: readonly unknown[],
  targetId: string,
): ApprovalParagraphLine[] {
  const index = paragraphs.findIndex((p) => isRecord(p) && (p as Record<string, unknown>).id === targetId);
  if (index < 0) return [];
  const lines: ApprovalParagraphLine[] = [];
  for (let i = Math.max(0, index - 1); i <= Math.min(paragraphs.length - 1, index + 1); i++) {
    const paragraph = paragraphs[i] as Record<string, unknown> | undefined;
    if (paragraph === undefined) continue;
    const text = asString(paragraph.text) ?? "";
    if (text === "") continue;
    lines.push({
      text: text.length > 120 ? `${text.slice(0, 120)}…` : text,
      state: i === index ? "old" : "ctx",
    });
  }
  return lines;
}

/** 卷章列表 → context list（目标标 current） */
function buildPublicationContext(
  volumes: readonly unknown[],
  chapters: readonly unknown[],
  targetId: string,
  kind: "volume" | "chapter",
): ApprovalContext | undefined {
  if (kind === "volume") {
    const nodes: ApprovalContextNode[] = volumes.map((v) => {
      const volume = v as Record<string, unknown>;
      return {
        id: asString(volume.id) ?? "",
        label: asString(volume.title) ?? "",
        state: volume.id === targetId ? "current" : "ctx",
      };
    });
    return { type: "list", nodes };
  }
  const volume = volumes.find((v) =>
    chapters.some(
      (c) => isRecord(c) && (c as Record<string, unknown>).volumeId === (v as Record<string, unknown>).id && (c as Record<string, unknown>).id === targetId,
    ),
  ) as Record<string, unknown> | undefined;
  const parent = volume !== undefined ? (asString(volume.title) ?? "") : undefined;
  const nodes: ApprovalContextNode[] = chapters.map((c) => {
    const chapter = c as Record<string, unknown>;
    return {
      id: asString(chapter.id) ?? "",
      label: asString(chapter.title) ?? "",
      state: chapter.id === targetId ? "current" : "ctx",
    };
  });
  return { type: "list", nodes, ...(parent !== undefined && parent !== "" ? { parent } : {}) };
}

/** 实体名提取（Write/Edit/Delete 目标标题用） */
function entityNameOf(entity: unknown, fallback: string): string {
  if (!isRecord(entity)) return fallback;
  const name = asString(entity.name) ?? asString(entity.title);
  return name ?? fallback;
}

/**
 * 创建 lite 实体解析器：edit/delete 经 api.novel.* 查实体当前内容，
 * 对比 patch 产出 diff 行；stale = baseRevision 与 entityVersion 不一致。
 * @param deps api（novel 查询）
 * @returns 解析器
 */
export function createApprovalEntityResolver(deps: {
  readonly api: NovelApiClient;
}): ApprovalEntityResolver {
  const { api } = deps;
  return async (target) => {
    if (target.op === "add") {
      return {
        kind: target.kind as ApprovalEntityKind,
        id: target.id,
        name:
          asString(target.value?.name) ?? asString(target.value?.title) ?? "新实体",
        op: "add",
        fields: buildFields(undefined, target.value, "add"),
        stale: false,
      };
    }
    let entity: unknown;
    let context: ApprovalContext | undefined;
    let paragraphs: ApprovalParagraphLine[] | undefined;
    try {
      switch (target.kind) {
        case "character":
          entity = await api.novel.characters.get(target.id as never);
          break;
        case "location":
          entity = await api.novel.locations.get(target.id as never);
          break;
        case "story_unit": {
          const outline = await api.novel.outline.get();
          entity = outline.units.find((u) => u.id === target.id);
          context = buildOutlineContext(outline.units, target.id);
          break;
        }
        case "paragraph": {
          entity = await api.novel.paragraphs.get(target.id as never);
          const paragraph = entity as { storyUnitId?: string } | undefined;
          if (paragraph?.storyUnitId !== undefined) {
            const siblings = await api.novel.paragraphs.list(paragraph.storyUnitId as never);
            paragraphs = buildParagraphContext(siblings, target.id);
          }
          break;
        }
        case "volume": {
          const publication = await api.novel.publication.get();
          entity = publication.volumes.find((v) => v.id === target.id);
          context = buildPublicationContext(publication.volumes, publication.chapters, target.id, "volume");
          break;
        }
        case "chapter": {
          const publication = await api.novel.publication.get();
          entity = publication.chapters.find((c) => c.id === target.id);
          context = buildPublicationContext(publication.volumes, publication.chapters, target.id, "chapter");
          break;
        }
        default:
          return undefined;
      }
    } catch {
      return undefined;
    }
    if (entity === undefined) return undefined;
    const current = entityToJsonObject(entity);
    const stale =
      target.baseRevision !== undefined &&
      typeof current.entityVersion === "number" &&
      current.entityVersion !== target.baseRevision;
    return {
      kind: target.kind as ApprovalEntityKind,
      id: target.id,
      name: entityNameOf(entity, target.id),
      op: target.op,
      fields:
        target.op === "delete"
          ? buildFields(current, undefined, "delete")
          : buildFields(current, target.value, "edit"),
      stale,
      ...(context !== undefined ? { context } : {}),
      ...(paragraphs !== undefined && paragraphs.length > 0 ? { paragraphs } : {}),
    };
  };
}
