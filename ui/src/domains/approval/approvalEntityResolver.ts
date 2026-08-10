/**
 * 审批目标实体解析器（v4：diff 行 + 上下文 + 写作方案）
 *
 * 把删除/编辑/写入审批中 values[] 里的目标解析为 ResolvedEntityContent：
 * 目标自身字段按 op 生成 diff 行（红=旧/删除、绿=新/新增、灰=上下文），
 * 并附带结构上下文（大纲树 / 卷章列表 / 相邻段落）与「写作方案」（leaf）。
 * baseRevision 为工作区级令牌非快照键，读接口返回当前 canonical（审批时
 * 未执行，即删除/编辑前内容）。
 *
 * Resolves add/edit/delete approval targets into diff-field lines plus
 * structural context (outline tree, volume/chapter list, neighboring
 * paragraphs) and the leaf "writing plan". baseRevision is a workspace token
 * (not a snapshot key); reads return current canonical.
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
import type { CharacterStore } from "../novel/character/store/CharacterStore.js";
import type { LocationStore } from "../novel/location/store/LocationStore.js";
import type { ManuscriptStructureStore } from "../novel/manuscript/store/ManuscriptStructureStore.js";
import type { StoryOutlineTreeNode } from "../novel/outline/projection/StoryOutlineTreeProjection.js";
import type { StoryOutlineTreeStore } from "../novel/outline/store/StoryOutlineTreeStore.js";
import { paramFieldRank, paramKeyLabel, paramValueLabel } from "./paramLabels.js";

export type ApprovalEntityKind =
  | "character"
  | "location"
  | "story_unit"
  | "chapter"
  | "volume"
  | "paragraph";

export type ApprovalFieldState = "add" | "edit" | "delete" | "ctx";

export interface ApprovalFieldLine {
  readonly field: string;
  readonly label: string;
  readonly old?: string;
  readonly new?: string;
  readonly state: ApprovalFieldState;
}

export interface ApprovalContextNode {
  readonly id: string;
  readonly label: string;
  readonly scope?: string;
  readonly status?: string;
  readonly state: "ctx" | "current" | "add" | "delete";
  readonly children?: readonly ApprovalContextNode[];
}

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

export interface ApprovalTarget {
  readonly kind: string;
  readonly id: string;
  readonly op: "add" | "edit" | "delete";
  /** add: 写入项字段；edit: patch value。Add item fields / edit patch. */
  readonly value?: JsonObject;
}

export interface ApprovalTargets {
  readonly targets: readonly ApprovalTarget[];
}

export interface ResolvedEntityContent {
  readonly kind: ApprovalEntityKind;
  readonly id: string;
  readonly name: string;
  readonly op: "add" | "edit" | "delete";
  readonly fields: readonly ApprovalFieldLine[];
  readonly context?: ApprovalContext;
  readonly paragraphs?: readonly ApprovalParagraphLine[];
  readonly leaf?: readonly ApprovalFieldLine[];
}

export type ApprovalEntityResolver = (
  target: ApprovalTarget,
) => Promise<ResolvedEntityContent | undefined>;

export interface ApprovalEntityResolverDeps {
  readonly api: NovelApiClient;
  readonly manuscript: ManuscriptStructureStore;
  readonly outline: StoryOutlineTreeStore;
  readonly characters: CharacterStore;
  readonly locations: LocationStore;
}

const ADD_KIND_BY_TOOL_NAME: Readonly<Record<string, string>> = {
  NovelOutlineWrite: "outline",
  NovelCharacterWrite: "character",
  NovelLocationWrite: "location",
  NovelParagraphWrite: "paragraph",
  NovelVolumeWrite: "volume",
  NovelChapterWrite: "chapter",
};

const EDIT_KIND_BY_TOOL_NAME: Readonly<Record<string, string>> = {
  NovelOutlineEdit: "outline",
  NovelCharacterEdit: "character",
  NovelLocationEdit: "location",
  NovelParagraphEdit: "paragraph",
  NovelVolumeEdit: "volume",
  NovelChapterEdit: "chapter",
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

function sortByRank(lines: readonly ApprovalFieldLine[]): ApprovalFieldLine[] {
  return [...lines].sort(
    (left, right) => paramFieldRank(left.field) - paramFieldRank(right.field),
  );
}

/** 从当前值与 patch 生成 diff 行。includeContext 时把未变字段作为灰色上下文行。 */
function buildFields(
  current: JsonObject | undefined,
  patch: JsonObject | undefined,
  op: "add" | "edit" | "delete",
  includeContext = false,
): ApprovalFieldLine[] {
  const lines: ApprovalFieldLine[] = [];
  if (op === "add") {
    for (const [field, value] of Object.entries(patch ?? {})) {
      if (SKIP_FIELDS.has(field)) continue;
      lines.push({ field, label: fieldLabel(field), new: formatValue(field, value), state: "add" });
    }
    return sortByRank(lines);
  }
  if (op === "edit") {
    for (const [field, newValue] of Object.entries(patch ?? {})) {
      if (SKIP_FIELDS.has(field)) continue;
      lines.push({
        field,
        label: fieldLabel(field),
        old: formatValue(field, current?.[field]),
        new: formatValue(field, newValue),
        state: "edit",
      });
    }
    if (includeContext) {
      for (const [field, curValue] of Object.entries(current ?? {})) {
        if (SKIP_FIELDS.has(field) || patch?.[field] !== undefined) continue;
        lines.push({ field, label: fieldLabel(field), new: formatValue(field, curValue), state: "ctx" });
      }
    }
    return sortByRank(lines);
  }
  for (const [field, value] of Object.entries(current ?? {})) {
    if (SKIP_FIELDS.has(field)) continue;
    lines.push({ field, label: fieldLabel(field), old: formatValue(field, value), state: "delete" });
  }
  return sortByRank(lines);
}

/** 把 kind 归一化为可解析的实体 kind（outline → story_unit）。 */
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

/** 从工具参数提取目标（add/edit/delete）；无 values 或 op 未知返回 undefined。 */
export function extractApprovalTargets(
  toolName: string,
  op: "add" | "edit" | "delete" | undefined,
  args: JsonValue | undefined,
): ApprovalTargets | undefined {
  if (args === undefined || !isRecord(args)) return undefined;
  const values = args.values;
  if (!Array.isArray(values)) return undefined;

  if (op === "add") {
    const kind = ADD_KIND_BY_TOOL_NAME[toolName];
    if (kind === undefined) return undefined;
    const targets: ApprovalTarget[] = [];
    values.forEach((item, index) => {
      if (!isRecord(item)) return;
      targets.push({
        kind,
        id: asString(item.id) ?? `#${index + 1}`,
        op,
        value: item,
      });
    });
    return targets.length === 0 ? undefined : Object.freeze({ targets: Object.freeze(targets) });
  }

  if (op === "delete") {
    const targets: ApprovalTarget[] = [];
    for (const item of values) {
      if (
        isRecord(item) &&
        typeof item.id === "string" &&
        typeof item.kind === "string" &&
        normalizeApprovalKind(item.kind) !== undefined
      ) {
        targets.push({ kind: item.kind, id: item.id, op });
      }
    }
    return targets.length === 0 ? undefined : Object.freeze({ targets: Object.freeze(targets) });
  }

  if (op === "edit") {
    const kind = EDIT_KIND_BY_TOOL_NAME[toolName];
    if (kind === undefined) return undefined;
    const targets: ApprovalTarget[] = [];
    for (const item of values) {
      if (!isRecord(item) || typeof item.id !== "string") continue;
      targets.push({
        kind,
        id: item.id,
        op,
        ...(isRecord(item.value) ? { value: item.value } : {}),
      });
    }
    return targets.length === 0 ? undefined : Object.freeze({ targets: Object.freeze(targets) });
  }

  return undefined;
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

/* ---------- 上下文构建 ---------- */

function outlineNode(
  node: StoryOutlineTreeNode,
  state: ApprovalContextNode["state"],
  deep: boolean,
): ApprovalContextNode {
  return {
    id: node.unitId,
    label: node.label,
    scope: node.scope,
    status: node.realNode,
    state,
    ...(node.children.length > 0
      ? { children: node.children.map((child) => outlineNode(child, state, deep)) }
      : {}),
  };
}

/** 新增单元不在树中：按 parentId 定位父节点，插入新节点（add）到兄弟旁。 */
function buildOutlineContextAdd(
  outline: StoryOutlineTreeStore,
  parentId: string,
  newId: string,
  newTitle: string,
): ApprovalContext | undefined {
  const tree = outline.getSnapshot().tree;
  const findParent = (nodes: readonly StoryOutlineTreeNode[]): StoryOutlineTreeNode | undefined => {
    for (const node of nodes) {
      if (node.unitId === parentId) return node;
      const sub = findParent(node.children);
      if (sub !== undefined) return sub;
    }
    return undefined;
  };
  const parent = findParent(tree);
  if (parent === undefined) return undefined;
  const siblings = parent.children.map((child) => ({
    id: child.unitId,
    label: child.label,
    scope: child.scope,
    status: child.realNode,
    state: "ctx" as const,
  }));
  return {
    type: "tree",
    nodes: [
      {
        id: parent.unitId,
        label: parent.label,
        scope: parent.scope,
        status: parent.realNode,
        state: "ctx",
        children: [
          ...siblings,
          {
            id: newId,
            label: newTitle,
            scope: parent.children[0]?.scope,
            state: "add",
          },
        ],
      },
    ],
  };
}

/** 大纲树上下文：从根到目标的路径 + 兄弟 + 目标下一级子节点。 */
function buildOutlineContext(
  outline: StoryOutlineTreeStore,
  target: ApprovalTarget,
): ApprovalContext | undefined {
  if (target.op === "add") {
    const parentId = asString(target.value?.parentId);
    if (parentId === undefined) return undefined;
    return buildOutlineContextAdd(
      outline,
      parentId,
      target.id,
      asString(target.value?.title) ?? target.id,
    );
  }
  const tree = outline.getSnapshot().tree;
  if (tree.length === 0) return undefined;
  const targetState: ApprovalContextNode["state"] =
    target.op === "delete" ? "delete" : "current";
  const ctxState: ApprovalContextNode["state"] =
    target.op === "delete" ? "delete" : "ctx";

  const visit = (
    nodes: readonly StoryOutlineTreeNode[],
  ): { node?: ApprovalContextNode; found?: boolean } => {
    for (const node of nodes) {
      if (node.unitId === target.id) {
        return {
          node: outlineNode(node, targetState, target.op === "delete"),
          found: true,
        };
      }
      const sub = visit(node.children);
      if (sub.found !== undefined && sub.node !== undefined) {
        const siblings = nodes
          .filter((sibling) => sibling !== node)
          .map((sibling) => outlineNode(sibling, ctxState, false));
        return {
          node: {
            id: node.unitId,
            label: node.label,
            scope: node.scope,
            status: node.realNode,
            state: "ctx",
            children: [...siblings, sub.node],
          },
          found: true,
        };
      }
    }
    return {};
  };

  const found = visit(tree);
  return found.node === undefined
    ? undefined
    : { type: "tree", nodes: [found.node] };
}

/** 相邻段落上下文：定位目标段所在章，前后各取 N 段 + 目标 old/new diff 行。 */
function buildParagraphLines(
  manuscript: ManuscriptStructureStore,
  paragraphId: string,
  op: "add" | "edit" | "delete",
  patchText?: string,
): ApprovalParagraphLine[] {
  for (const chapter of manuscript.getSnapshot().chapters) {
    const index = chapter.blocks.findIndex((block) => block.blockId === paragraphId);
    if (index === -1) continue;
    const blocks = chapter.blocks;
    const lines: ApprovalParagraphLine[] = [];
    for (let i = Math.max(0, index - 2); i < index; i++) {
      lines.push({ text: blocks[i].text || "", state: "ctx" });
    }
    if (op === "add") {
      lines.push({ text: patchText ?? "", state: "new" });
    } else if (op === "delete") {
      lines.push({ text: blocks[index].text, state: "old" });
    } else {
      lines.push({ text: blocks[index].text, state: "old" });
      lines.push({ text: patchText ?? blocks[index].text, state: "new" });
    }
    for (let i = index + 1; i <= Math.min(blocks.length - 1, index + 2); i++) {
      lines.push({ text: blocks[i].text || "", state: "ctx" });
    }
    return lines;
  }
  return [];
}

/** 章内段落内容（正文块）：把章内 blocks 作为上下文行。 */
function buildChapterParagraphs(
  manuscript: ManuscriptStructureStore,
  chapterId: string,
): ApprovalParagraphLine[] {
  const chapter = manuscript
    .getSnapshot()
    .chapters.find((item) => item.chapterId === chapterId);
  if (chapter === undefined) return [];
  return chapter.blocks.map((block) => ({
    text: block.text || "",
    state: "ctx" as const,
  }));
}

/** 卷列表上下文：相邻卷 + 当前卷（含子章）。 */
function buildVolumeList(
  manuscript: ManuscriptStructureStore,
  volumeId: string,
  op: "add" | "edit" | "delete",
): ApprovalContext | undefined {
  const volumes = manuscript.getSnapshot().volumes;
  const index = volumes.findIndex((volume) => volume.volumeId === volumeId);
  if (index === -1) return undefined;
  const targetState: ApprovalContextNode["state"] =
    op === "delete" ? "delete" : op === "add" ? "add" : "current";
  const childState: ApprovalContextNode["state"] =
    op === "delete" ? "delete" : "ctx";
  const nodes: ApprovalContextNode[] = [];
  for (let i = Math.max(0, index - 1); i < index; i++) {
    nodes.push({ id: volumes[i].volumeId, label: volumes[i].title, scope: "VOL", state: "ctx" });
  }
  nodes.push({
    id: volumeId,
    label: volumes[index].title,
    scope: "VOL",
    state: targetState,
    children: volumes[index].chapters.map((chapter) => ({
      id: chapter.chapterId,
      label: chapter.title,
      scope: "CH",
      state: childState,
    })),
  });
  for (let i = index + 1; i <= Math.min(volumes.length - 1, index + 1); i++) {
    nodes.push({ id: volumes[i].volumeId, label: volumes[i].title, scope: "VOL", state: "ctx" });
  }
  return { type: "list", nodes };
}

/** 章列表上下文：所属卷 + 相邻章（当前章高亮）。 */
function buildChapterList(
  manuscript: ManuscriptStructureStore,
  chapterId: string,
  op: "add" | "edit" | "delete",
): ApprovalContext | undefined {
  const volumes = manuscript.getSnapshot().volumes;
  const chapter = manuscript
    .getSnapshot()
    .chapters.find((item) => item.chapterId === chapterId);
  if (chapter === undefined) return undefined;
  const volume = volumes.find((item) => item.volumeId === chapter.volumeId);
  if (volume === undefined) return undefined;
  const targetState: ApprovalContextNode["state"] =
    op === "delete" ? "delete" : op === "add" ? "add" : "current";
  return {
    type: "list",
    parent: volume.title,
    nodes: [
      {
        id: volume.volumeId,
        label: volume.title,
        scope: "VOL",
        state: "ctx",
        children: volume.chapters.map((sibling) => ({
          id: sibling.chapterId,
          label: sibling.title,
          scope: "CH",
          state: sibling.chapterId === chapterId ? targetState : "ctx",
        })),
      },
    ],
  };
}

/* ---------- 写作方案（leaf） ---------- */

function involvementText(binding: Record<string, unknown>, charName: string): string {
  const involvement = isRecord(binding.involvement) ? binding.involvement : undefined;
  const presence = asString(involvement?.presence);
  const presenceLabel = presence === undefined ? "" : `（${paramValueLabel("presence", presence) ?? presence}`;
  const roles = involvement?.roles;
  const roleLabel = Array.isArray(roles) && roles.length > 0
    ? ` · ${roles.map((role) => paramValueLabel("roles", asString(role) ?? "") ?? role).join("/")}`
    : "";
  return `${charName}${presenceLabel}${roleLabel}${presence !== undefined ? "）" : ""}`;
}

function locationText(binding: Record<string, unknown>, locName: string): string {
  const involvement = isRecord(binding.involvement) ? binding.involvement : undefined;
  const role = asString(involvement?.role);
  const roleLabel = role === undefined ? "" : `（${paramValueLabel("locationRole", role) ?? role}）`;
  return `${locName}${roleLabel}`;
}

function formatLeafValue(
  field: string,
  value: JsonValue | undefined,
  characters: CharacterStore,
  locations: LocationStore,
): string {
  if (value === undefined) return "—";
  if (field === "settingMode") {
    return value === "located"
      ? "定点场景"
      : value === "location-independent"
        ? "非定点场景"
        : formatValue(field, value);
  }
  if (field === "time") {
    return isRecord(value)
      ? (asString(value.description) ?? JSON.stringify(value))
      : formatValue(field, value);
  }
  if (field === "characters" && Array.isArray(value)) {
    const names = new Map(
      characters.getSnapshot().characters.map((item) => [item.characterId, item.name]),
    );
    return value
      .map((binding) =>
        isRecord(binding)
          ? involvementText(binding, asString(binding.characterId) !== undefined ? (names.get(asString(binding.characterId)!) ?? asString(binding.characterId)!) : "")
          : "",
      )
      .filter(Boolean)
      .join("、");
  }
  if (field === "locations" && Array.isArray(value)) {
    const names = new Map(
      locations.getSnapshot().locations.map((item) => [item.locationId, item.name]),
    );
    return value
      .map((binding) =>
        isRecord(binding)
          ? locationText(binding, asString(binding.locationId) !== undefined ? (names.get(asString(binding.locationId)!) ?? asString(binding.locationId)!) : "")
          : "",
      )
      .filter(Boolean)
      .join("、");
  }
  if (field === "events" && Array.isArray(value)) {
    return value
      .map((event) => (isRecord(event) ? (asString(event.description) ?? "") : ""))
      .filter(Boolean)
      .join("；");
  }
  if (field === "rhythmBeats" && Array.isArray(value)) {
    return value
      .map((beat) =>
        isRecord(beat)
          ? `${paramValueLabel("rhythm", asString(beat.rhythm) ?? "") ?? beat.rhythm}（强度 ${String(beat.intensity ?? "")}）`
          : "",
      )
      .filter(Boolean)
      .join(" → ");
  }
  if (field === "entityChanges" && Array.isArray(value)) {
    return value
      .map((change) =>
        isRecord(change)
          ? `${paramValueLabel("entityType", asString(change.entityType) ?? "") ?? change.entityType} · ${paramValueLabel("category", asString(change.category) ?? "") ?? change.category}：${asString(change.summary) ?? ""}`
          : "",
      )
      .filter(Boolean)
      .join("；");
  }
  return formatValue(field, value);
}

/** 写作方案（leaf）：add/edit 从 args 取新方案，绿行展示。 */
function buildLeafLines(
  leaf: JsonObject | undefined,
  op: "add" | "edit",
  characters: CharacterStore,
  locations: LocationStore,
): ApprovalFieldLine[] | undefined {
  if (leaf === undefined) return undefined;
  const fields = [
    "settingMode",
    "time",
    "characters",
    "locations",
    "events",
    "rhythmBeats",
    "entityChanges",
  ];
  const lines: ApprovalFieldLine[] = [];
  for (const field of fields) {
    const value = leaf[field];
    if (value === undefined) continue;
    lines.push({
      field,
      label: fieldLabel(field),
      new: formatLeafValue(field, value, characters, locations),
      state: "add",
    });
  }
  return lines;
}

/* ---------- 各 kind 分支 ---------- */

async function resolveCharacter(
  api: NovelApiClient,
  target: ApprovalTarget,
): Promise<ResolvedEntityContent | undefined> {
  if (target.op === "add") {
    const value = target.value ?? {};
    return {
      kind: "character",
      id: target.id,
      name: asString(value.name) ?? target.id,
      op: "add",
      fields: buildFields(undefined, value, "add"),
    };
  }
  const result = await api.novel.characters.get(
    canonicalNovelQueryScope,
    target.id as CharacterId,
  );
  const character = result.character;
  if (character === undefined) return undefined;
  const current: JsonObject = {
    name: character.name,
    aliases: [...character.aliases],
    ...(character.summary === undefined ? {} : { summary: character.summary }),
    ...(character.initialState === undefined
      ? {}
      : { initialState: character.initialState }),
    ...(character.authorNotes === undefined
      ? {}
      : { authorNotes: character.authorNotes }),
  };
  const name = character.name;
  if (target.op === "delete") {
    return { kind: "character", id: target.id, name, op: "delete", fields: buildFields(current, undefined, "delete") };
  }
  return {
    kind: "character",
    id: target.id,
    name,
    op: "edit",
    fields: buildFields(current, target.value, "edit", true),
  };
}

async function resolveLocation(
  api: NovelApiClient,
  target: ApprovalTarget,
): Promise<ResolvedEntityContent | undefined> {
  if (target.op === "add") {
    const value = target.value ?? {};
    return {
      kind: "location",
      id: target.id,
      name: asString(value.name) ?? target.id,
      op: "add",
      fields: buildFields(undefined, value, "add"),
    };
  }
  const result = await api.novel.locations.get(
    canonicalNovelQueryScope,
    target.id as LocationId,
  );
  const location = result.location;
  if (location === undefined) return undefined;
  const current: JsonObject = {
    name: location.name,
    aliases: [...location.aliases],
    ...(location.summary === undefined ? {} : { summary: location.summary }),
    ...(location.initialState === undefined
      ? {}
      : { initialState: location.initialState }),
    ...(location.authorNotes === undefined
      ? {}
      : { authorNotes: location.authorNotes }),
  };
  const name = location.name;
  if (target.op === "delete") {
    return { kind: "location", id: target.id, name, op: "delete", fields: buildFields(current, undefined, "delete") };
  }
  return {
    kind: "location",
    id: target.id,
    name,
    op: "edit",
    fields: buildFields(current, target.value, "edit", true),
  };
}

async function resolveStoryUnit(
  api: NovelApiClient,
  outline: StoryOutlineTreeStore,
  characters: CharacterStore,
  locations: LocationStore,
  target: ApprovalTarget,
): Promise<ResolvedEntityContent | undefined> {
  const context = buildOutlineContext(outline, target);
  if (target.op === "add") {
    const value = target.value ?? {};
    const leaf = isRecord(value.leaf) ? value.leaf : undefined;
    return {
      kind: "story_unit",
      id: target.id,
      name: asString(value.title) ?? target.id,
      op: "add",
      fields: buildFields(undefined, value, "add"),
      context,
      ...(leaf === undefined
        ? {}
        : { leaf: buildLeafLines(leaf, "add", characters, locations) }),
    };
  }
  const result = await api.novel.outline.getStoryUnit(
    canonicalNovelQueryScope,
    target.id as StoryUnitId,
  );
  const unit = result.unit;
  if (unit === undefined) return undefined;
  const current: JsonObject = {
    title: unit.title,
    ...(unit.intent === undefined ? {} : { intent: unit.intent }),
    ...(unit.synopsis === undefined ? {} : { synopsis: unit.synopsis }),
    ...(unit.scope === undefined ? {} : { scope: unit.scope }),
    planningStatus: unit.planningStatus,
    realizationStatus: unit.realizationStatus,
    ...(unit.blockState === undefined
      ? {}
      : { blockState: unit.blockState as unknown as JsonValue }),
    ...(unit.abandonment === undefined
      ? {}
      : { abandonment: unit.abandonment as unknown as JsonValue }),
  };
  const name = unit.title;
  if (target.op === "delete") {
    return {
      kind: "story_unit",
      id: target.id,
      name,
      op: "delete",
      fields: buildFields(current, undefined, "delete"),
      context,
    };
  }
  const patch = target.value ?? {};
  const patchLeaf = isRecord(patch.leaf) ? patch.leaf : undefined;
  return {
    kind: "story_unit",
    id: target.id,
    name,
    op: "edit",
    fields: buildFields(current, patch, "edit"),
    context,
    ...(patchLeaf === undefined
      ? {}
      : { leaf: buildLeafLines(patchLeaf, "edit", characters, locations) }),
  };
}

function resolveVolume(
  manuscript: ManuscriptStructureStore,
  target: ApprovalTarget,
): ResolvedEntityContent | undefined {
  if (target.op === "add") {
    const value = target.value ?? {};
    return {
      kind: "volume",
      id: target.id,
      name: asString(value.title) ?? target.id,
      op: "add",
      fields: buildFields(undefined, value, "add"),
      context: buildVolumeList(manuscript, target.id, "add"),
    };
  }
  const volume = manuscript
    .getSnapshot()
    .volumes.find((item) => item.volumeId === target.id);
  if (volume === undefined) return undefined;
  const name = volume.title;
  const current: JsonObject = { title: volume.title };
  if (target.op === "delete") {
    return {
      kind: "volume",
      id: target.id,
      name,
      op: "delete",
      fields: buildFields(current, undefined, "delete"),
      context: buildVolumeList(manuscript, target.id, "delete"),
    };
  }
  return {
    kind: "volume",
    id: target.id,
    name,
    op: "edit",
    fields: buildFields(current, target.value, "edit"),
    context: buildVolumeList(manuscript, target.id, "edit"),
  };
}

function resolveChapter(
  manuscript: ManuscriptStructureStore,
  target: ApprovalTarget,
): ResolvedEntityContent | undefined {
  if (target.op === "add") {
    const value = target.value ?? {};
    return {
      kind: "chapter",
      id: target.id,
      name: asString(value.title) ?? target.id,
      op: "add",
      fields: buildFields(undefined, value, "add"),
      context: buildChapterList(manuscript, target.id, "add"),
      paragraphs: buildChapterParagraphs(manuscript, target.id),
    };
  }
  const chapter = manuscript
    .getSnapshot()
    .chapters.find((item) => item.chapterId === target.id);
  if (chapter === undefined) return undefined;
  const name = chapter.title;
  const current: JsonObject = {
    title: chapter.title,
    ...(chapter.orderKey === undefined ? {} : { orderKey: chapter.orderKey }),
  };
  if (target.op === "delete") {
    return {
      kind: "chapter",
      id: target.id,
      name,
      op: "delete",
      fields: buildFields(current, undefined, "delete"),
      context: buildChapterList(manuscript, target.id, "delete"),
      paragraphs: buildChapterParagraphs(manuscript, target.id),
    };
  }
  return {
    kind: "chapter",
    id: target.id,
    name,
    op: "edit",
    fields: buildFields(current, target.value, "edit"),
    context: buildChapterList(manuscript, target.id, "edit"),
    paragraphs: buildChapterParagraphs(manuscript, target.id),
  };
}

async function resolveParagraph(
  api: NovelApiClient,
  manuscript: ManuscriptStructureStore,
  target: ApprovalTarget,
): Promise<ResolvedEntityContent | undefined> {
  const patchText = asString(target.value?.text);
  if (target.op === "add") {
    return {
      kind: "paragraph",
      id: target.id,
      name: (patchText ?? "").slice(0, 16) || target.id,
      op: "add",
      fields: buildFields(undefined, target.value, "add"),
      paragraphs: buildParagraphLines(manuscript, target.id, "add", patchText),
    };
  }
  // 找当前块文本
  let currentText = "";
  for (const chapter of manuscript.getSnapshot().chapters) {
    const block = chapter.blocks.find((item) => item.blockId === target.id);
    if (block !== undefined) {
      currentText = block.text;
      break;
    }
  }
  if (currentText === "") {
    try {
      const result = await api.novel.paragraphs.get(
        canonicalNovelQueryScope,
        target.id as ParagraphId,
      );
      currentText = result.readModel?.paragraph.text ?? "";
    } catch {
      // 保持空
    }
  }
  if (currentText === "") return undefined;
  const name = currentText.slice(0, 16) || target.id;
  if (target.op === "delete") {
    return {
      kind: "paragraph",
      id: target.id,
      name,
      op: "delete",
      fields: [],
      paragraphs: buildParagraphLines(manuscript, target.id, "delete", patchText),
    };
  }
  return {
    kind: "paragraph",
    id: target.id,
    name,
    op: "edit",
    fields: [],
    paragraphs: buildParagraphLines(manuscript, target.id, "edit", patchText),
  };
}

/** 从 API + stores 构建解析器；解析失败一律返回 undefined。 */
export function createApprovalEntityResolver(
  deps: ApprovalEntityResolverDeps,
): ApprovalEntityResolver {
  const { api, manuscript, outline, characters, locations } = deps;
  return async (target) => {
    const kind = normalizeApprovalKind(target.kind);
    if (kind === undefined) return undefined;
    try {
      switch (kind) {
        case "character":
          return await resolveCharacter(api, target);
        case "location":
          return await resolveLocation(api, target);
        case "story_unit":
          return await resolveStoryUnit(api, outline, characters, locations, target);
        case "volume":
          return resolveVolume(manuscript, target);
        case "chapter":
          return resolveChapter(manuscript, target);
        case "paragraph":
          return await resolveParagraph(api, manuscript, target);
      }
    } catch {
      return undefined;
    }
  };
}
