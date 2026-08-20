/**
 * novel 域通用工具（PRD docs/PRD/novel-tools-通用合并.md）。
 *
 * - 形态：4 件工具 NovelRead / NovelWrite / NovelEdit / NovelDelete，六域三件套
 *   （19 件 Novel* 工具）收敛为 kind 分发；参数字段名与形状沿用 legacy 契约零变化，
 *   仅工具名收敛 + 顶层新增 kind。
 * - kind：character / location / story_unit / paragraph / volume / chapter（与
 *   NovelDelete 一致）；NovelRead 另有 overview（novel-db overview.get 首次暴露）。
 * - 校验：kind 与参数不匹配（Read 顶层过滤字段 / Write values 项字段 / Edit value
 *   字段）报 TOOL_ARGUMENTS_INVALID；各 kind 必填字段由 handler 收窄校验。
 * - 形状：Write `{ kind, values:[{…}] }`（1-64 项，id 可自选，重复 duplicate_id）；
 *   Edit `{ kind, values:[{id, baseRevision, value}] }`；Delete `{ cascade?, values:[{kind,id,baseRevision}] }`。
 * - 约束：ID_PATTERN / ORDER_KEY_PATTERN（hex 4 位组）+ 字段长度/数量上限（legacy 同款）。
 * - 预检：precheck 在审批请求提交前校验存在性/乐观锁/id 占用（失败不进审批）；
 *   Delete 对 character/location 额外做 leaf 引用检查（悬空引用防护，cascade 不豁免）。
 * - 原子：写批经 mutateBatch 单事务执行，任一项失败整批回滚。
 * - 描述：中文 + Markdown 骨架（小说数据模型仅 NovelRead 详述，Write/Edit 引用）。
 */
import type { ToolDef } from "../ToolDef.js";
import type { ToolCall } from "../../provider/types.js";
import type { NovelHandle } from "../../../novel/client/NovelHandle.js";
import type { NovelMutateResult } from "../../../novel/contract/snapshot.js";
import type { OrderKey } from "../../../novel/model/outline.js";
import { LEAF_RHYTHMS } from "../../../novel/model/outline.js";
import { ID_PATTERN, ORDER_KEY_PATTERN } from "../../../novel/keys.js";
import {
  novelReadPreview,
  novelWritePreview,
  novelEditPreview,
  novelDeletePreview,
} from "../previews.js";
import { ToolError } from "../errors.js";

function parseArgs(call: ToolCall): Record<string, unknown> {
  try {
    return JSON.parse(call.args) as Record<string, unknown>;
  } catch {
    throw new ToolError(
      { code: "TOOL_ARGUMENTS_INVALID", toolName: call.name },
      `无效的 JSON 参数: ${call.args}`,
    );
  }
}

/** 实体档案输入（name + 别名 + 摘要 + 初始状态 + 作者备注） */
interface EntityInput {
  name: string;
  aliases?: readonly string[];
  summary?: string;
  initialState?: string;
  authorNotes?: string;
}

/** Edit/Delete 项：目标 id + 乐观锁版本 */
interface TargetedItem {
  id: string;
  baseRevision: number;
}

/** 版本索引：id → 当前 entityVersion（预检用） */
type VersionIndex = ReadonlyMap<string, number>;

/** NovelRead/Write/Edit 的实体 kind（与 NovelDelete 的 values[].kind 一致） */
type NovelKind = "character" | "location" | "story_unit" | "paragraph" | "volume" | "chapter";

/** kind → 中文标签（预检报错与 desc 共用口径） */
const KIND_LABELS: Record<NovelKind, string> = {
  character: "角色",
  location: "地点",
  story_unit: "大纲单元",
  paragraph: "段落",
  volume: "卷",
  chapter: "章",
};

/** values 数组解析（缺省空数组） */
function valuesOf(args: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(args.values) ? (args.values as Record<string, unknown>[]) : [];
}

/** string 字段读取（缺省 undefined） */
function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/** 参数校验失败（kind 非法 / kind 与参数不匹配 / values 项字段不合法） */
function argsFail(toolName: string, message: string): ToolError {
  return new ToolError({ code: "TOOL_ARGUMENTS_INVALID", toolName }, message);
}

/** 预检失败错误（AgentLoop 在审批前收口，不进审批批） */
function precheckFail(toolName: string, message: string): ToolError {
  return new ToolError({ code: "TOOL_PRECHECK_FAILED", toolName }, message);
}

/** 预检：目标存在 + baseRevision 未过期（过期附当前版本，模型可自纠） */
function assertRevision(toolName: string, versions: VersionIndex, id: string, baseRevision: number, label: string): void {
  const current = versions.get(id);
  if (current === undefined) {
    throw precheckFail(toolName, `未找到 ${label} ${id}——请先读取确认目标存在`);
  }
  if (current !== baseRevision) {
    throw precheckFail(
      toolName,
      `${label} ${id} 版本过期：当前 entityVersion ${current}，请求基于 ${baseRevision}——请重新读取后再提交`,
    );
  }
}

/** 预检：自选 id 未被占用（duplicate_id） */
function assertIdFree(toolName: string, versions: VersionIndex, id: string, label: string): void {
  if (versions.has(id)) {
    throw precheckFail(toolName, `id 重复（duplicate_id）：${label} ${id} 已存在`);
  }
}

/** 预检：引用的父/目标实体存在 */
function assertExists(toolName: string, versions: VersionIndex, id: string, label: string): void {
  if (!versions.has(id)) {
    throw precheckFail(toolName, `引用的 ${label} ${id} 不存在`);
  }
}

/** 批量变更结果 → legacy items 形态（批内原子：全 applied 或整批抛错） */
function formatBatchItems(results: readonly NovelMutateResult[]): string {
  return JSON.stringify(
    { items: results.map((r) => ({ id: r.changeId, status: "applied", version: r.version })) },
    null,
    2,
  );
}

// ── leaf 计划 / 阻塞 / 废弃 schema（legacy LeafPlan/BlockState/Abandonment 同构） ──

/** leaf 计划属性集（Write 全量形态；Edit 复用为可空补丁形态） */
const LEAF_PLAN_PROPERTIES: Record<string, unknown> = {
  settingMode: {
    type: "string",
    enum: ["located", "location-independent"],
    description: "场景模式：located=有确定地点 / location-independent=无固定地点",
  },
  time: {
    type: "object",
    description: "时间设定",
    properties: {
      description: { type: "string", minLength: 1, maxLength: 20000, description: "时间描述" },
      timelineOrderKey: { type: "string", minLength: 4, maxLength: 512, description: "时间线排序键" },
    },
    required: ["description"],
    additionalProperties: false,
  },
  characters: {
    type: "array",
    maxItems: 128,
    description: "人物绑定（在场方式与参与角色）",
    items: {
      type: "object",
      properties: {
        characterId: { type: "string", pattern: ID_PATTERN, description: "绑定角色 id" },
        involvement: {
          type: "object",
          description: "在场与参与",
          properties: {
            presence: {
              type: "string",
              enum: ["present", "offstage", "mentioned"],
              description: "在场方式：present=在场 / offstage=幕后 / mentioned=被提及",
            },
            roles: {
              type: "array",
              maxItems: 4,
              items: {
                type: "string",
                enum: ["point-of-view", "participant", "observer", "affected"],
              },
              description: "参与角色：point-of-view=视角 / participant=参与者 / observer=旁观者 / affected=受影响者",
            },
          },
          required: ["presence", "roles"],
          additionalProperties: false,
        },
        note: { type: "string", maxLength: 20000, description: "备注" },
      },
      required: ["characterId"],
      additionalProperties: false,
    },
  },
  locations: {
    type: "array",
    maxItems: 128,
    description: "地点绑定（主/次/提及）",
    items: {
      type: "object",
      properties: {
        locationId: { type: "string", pattern: ID_PATTERN, description: "绑定地点 id" },
        involvement: {
          type: "object",
          description: "参与方式",
          properties: {
            role: {
              type: "string",
              enum: ["primary", "secondary", "mentioned"],
              description: "role：primary=主场景 / secondary=次要 / mentioned=被提及",
            },
            affected: { type: "boolean", description: "地点状态是否被改变" },
          },
          required: ["role", "affected"],
          additionalProperties: false,
        },
        note: { type: "string", maxLength: 20000, description: "备注" },
      },
      required: ["locationId"],
      additionalProperties: false,
    },
  },
  events: {
    type: "array",
    maxItems: 512,
    description: "事件序列（场景内按 orderKey 排序）",
    items: {
      type: "object",
      properties: {
        id: { type: "string", pattern: ID_PATTERN, description: "事件 id（leaf 内唯一）" },
        orderKey: { type: "string", minLength: 4, maxLength: 512, description: "排序键" },
        description: { type: "string", minLength: 1, maxLength: 20000, description: "事件描述" },
      },
      required: ["id", "orderKey", "description"],
      additionalProperties: false,
    },
  },
  rhythmBeats: {
    type: "array",
    maxItems: 512,
    description: "节奏拍（叙事节拍：setup→climax→aftermath 八档 + 强度 1-5）",
    items: {
      type: "object",
      properties: {
        id: { type: "string", pattern: ID_PATTERN, description: "拍 id（leaf 内唯一）" },
        orderKey: { type: "string", minLength: 4, maxLength: 512, description: "排序键" },
        rhythm: {
          type: "string",
          enum: [...LEAF_RHYTHMS],
          description: "节拍：setup=铺垫 / rise=上升 / hold=维持 / turn=转折 / climax=高潮 / fall=回落 / release=释放 / aftermath=余波",
        },
        intensity: { type: "integer", minimum: 1, maximum: 5, description: "强度 1-5" },
        readerEmotion: { type: "string", maxLength: 20000, description: "读者情绪" },
        pointOfViewEmotion: { type: "string", maxLength: 20000, description: "视角人物情绪" },
        description: { type: "string", maxLength: 20000, description: "描述" },
        relatedEventIds: { type: "array", items: { type: "string", pattern: ID_PATTERN }, maxItems: 64, description: "关联事件 id" },
      },
      required: ["id", "orderKey", "rhythm", "intensity", "relatedEventIds"],
      additionalProperties: false,
    },
  },
  entityChanges: {
    type: "array",
    maxItems: 512,
    description: "实体状态变更（连贯性追踪：本场景结束后人物/地点的状态变化）",
    items: {
      type: "object",
      properties: {
        id: { type: "string", pattern: ID_PATTERN, description: "变更 id（leaf 内唯一）" },
        entityType: { type: "string", enum: ["character", "location"], description: "实体类型" },
        entityId: { type: "string", pattern: ID_PATTERN, description: "实体 id" },
        relatedEntityId: { type: "string", pattern: ID_PATTERN, description: "关联实体（关系类变更的另一端）" },
        category: {
          type: "string",
          enum: ["identity", "condition", "location", "relationship", "knowledge", "goal", "ownership", "environment", "custom"],
          description: "类别：identity=身份 / condition=状态 / location=位置 / relationship=关系 / knowledge=认知 / goal=目标 / ownership=归属 / environment=环境 / custom=自定义",
        },
        summary: { type: "string", minLength: 1, maxLength: 20000, description: "变更摘要" },
        sourceEventIds: { type: "array", items: { type: "string", pattern: ID_PATTERN }, maxItems: 64, description: "来源事件 id" },
      },
      required: ["id", "entityType", "entityId", "category", "summary", "sourceEventIds"],
      additionalProperties: false,
    },
  },
};

/** 属性集 → 可空补丁形态（每个属性 type 加 null；except 中的保持原样） */
function nullableProps(props: Record<string, unknown>, except: readonly string[] = []): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(props).map(([key, value]) => {
      if (except.includes(key)) return [key, value];
      const spec = value as { type?: unknown };
      const t = spec.type;
      return [key, { ...spec, type: Array.isArray(t) ? [...t, "null"] : [t, "null"] }];
    }),
  );
}

/** 阻塞状态 schema（nullable=true 为 Edit 形态：null 清除） */
function blockStateSchema(nullable: boolean): Record<string, unknown> {
  const schema: Record<string, unknown> = {
    type: nullable ? ["object", "null"] : "object",
    description: "阻塞状态（reasonCode 六类 + 依赖单元；null 清除）",
    properties: {
      reasonCode: {
        type: "string",
        enum: ["dependency", "decision-required", "continuity-conflict", "missing-material", "outline-incomplete", "other"],
        description: "阻塞原因：dependency=依赖未就绪 / decision-required=待决策 / continuity-conflict=连贯性冲突 / missing-material=缺素材 / outline-incomplete=大纲不全 / other=其他",
      },
      note: { type: "string", maxLength: 20000, description: "说明" },
      dependencyIds: { type: "array", items: { type: "string", pattern: ID_PATTERN }, maxItems: 64, description: "依赖的大纲单元 id 列表" },
      blockedAt: { type: "string", minLength: 1, maxLength: 64, description: "阻塞时间戳" },
    },
    required: ["dependencyIds", "blockedAt"],
    additionalProperties: false,
  };
  return schema;
}

/** 废弃状态 schema（nullable=true 为 Edit 形态：null 清除） */
function abandonmentSchema(nullable: boolean): Record<string, unknown> {
  return {
    type: nullable ? ["object", "null"] : "object",
    description: "废弃状态（reasonCode 六类 + 替换单元；null 清除）",
    properties: {
      reasonCode: {
        type: "string",
        enum: ["story-direction-changed", "replaced", "merged", "duplicate", "scope-reduced", "other"],
        description: "废弃原因：story-direction-changed=方向变更 / replaced=被替换 / merged=被合并 / duplicate=重复 / scope-reduced=缩减 / other=其他",
      },
      note: { type: "string", maxLength: 20000, description: "说明" },
      replacementStoryUnitId: { type: "string", pattern: ID_PATTERN, description: "替换单元 id" },
      abandonedAt: { type: "string", minLength: 1, maxLength: 64, description: "废弃时间戳" },
    },
    required: ["reasonCode", "abandonedAt"],
    additionalProperties: false,
  };
}

// ── 预检版本索引（按域一次拉取，批内共享） ──

async function characterVersions(handle: NovelHandle): Promise<VersionIndex> {
  const list = (await handle.query({ op: "characters.list" })) as { id: string; entityVersion: number }[];
  return new Map(list.map((c) => [c.id, c.entityVersion]));
}
async function locationVersions(handle: NovelHandle): Promise<VersionIndex> {
  const list = (await handle.query({ op: "locations.list" })) as { id: string; entityVersion: number }[];
  return new Map(list.map((l) => [l.id, l.entityVersion]));
}
async function storyUnitVersions(handle: NovelHandle): Promise<VersionIndex> {
  const snap = (await handle.query({ op: "outline.get" })) as { units: { id: string; entityVersion: number }[] };
  return new Map(snap.units.map((u) => [u.id, u.entityVersion]));
}
async function paragraphVersions(handle: NovelHandle): Promise<VersionIndex> {
  const list = (await handle.query({ op: "paragraphs.list" })) as { id: string; entityVersion: number }[];
  return new Map(list.map((p) => [p.id, p.entityVersion]));
}
async function publicationVersions(handle: NovelHandle): Promise<{ volumes: VersionIndex; chapters: VersionIndex }> {
  const snap = (await handle.query({ op: "publication.get" })) as {
    volumes: { id: string; entityVersion: number }[];
    chapters: { id: string; entityVersion: number }[];
  };
  return {
    volumes: new Map(snap.volumes.map((v) => [v.id, v.entityVersion])),
    chapters: new Map(snap.chapters.map((c) => [c.id, c.entityVersion])),
  };
}

/** leaf 计划 / 阻塞 / 废弃里引用的实体 id 收集（预检存在性用） */
function collectReferences(sources: ReadonlyArray<Record<string, unknown> | undefined>): {
  characterIds: Set<string>;
  locationIds: Set<string>;
  unitIds: Set<string>;
} {
  const characterIds = new Set<string>();
  const locationIds = new Set<string>();
  const unitIds = new Set<string>();
  const pushLeaf = (leaf: unknown): void => {
    if (leaf === undefined || leaf === null || typeof leaf !== "object") return;
    const l = leaf as Record<string, unknown>;
    for (const c of Array.isArray(l.characters) ? l.characters : []) {
      const id = str((c as Record<string, unknown>)?.characterId);
      if (id !== undefined) characterIds.add(id);
    }
    for (const loc of Array.isArray(l.locations) ? l.locations : []) {
      const id = str((loc as Record<string, unknown>)?.locationId);
      if (id !== undefined) locationIds.add(id);
    }
    for (const e of Array.isArray(l.entityChanges) ? l.entityChanges : []) {
      const rec = e as Record<string, unknown>;
      const isLocation = rec?.entityType === "location";
      const eid = str(rec?.entityId);
      if (eid !== undefined) (isLocation ? locationIds : characterIds).add(eid);
      const rel = str(rec?.relatedEntityId);
      if (rel !== undefined) (isLocation ? locationIds : characterIds).add(rel);
    }
  };
  for (const src of sources) {
    if (src === undefined) continue;
    pushLeaf(src.leaf);
    const block = src.blockState;
    if (block !== undefined && block !== null && typeof block === "object") {
      const deps = (block as Record<string, unknown>).dependencyIds;
      for (const d of Array.isArray(deps) ? deps : []) {
        if (typeof d === "string") unitIds.add(d);
      }
    }
    const abandon = src.abandonment;
    const rep =
      abandon !== undefined && abandon !== null && typeof abandon === "object"
        ? str((abandon as Record<string, unknown>).replacementStoryUnitId)
        : undefined;
    if (rep !== undefined) unitIds.add(rep);
  }
  return { characterIds, locationIds, unitIds };
}

/** 预检引用存在性（索引懒拉取；units 已有则复用） */
async function assertReferencesExist(
  handle: NovelHandle,
  toolName: string,
  refs: { characterIds: Set<string>; locationIds: Set<string>; unitIds: Set<string> },
  unitsAlready?: VersionIndex,
): Promise<void> {
  if (refs.characterIds.size > 0) {
    const versions = await characterVersions(handle);
    for (const id of refs.characterIds) assertExists(toolName, versions, id, "角色");
  }
  if (refs.locationIds.size > 0) {
    const versions = await locationVersions(handle);
    for (const id of refs.locationIds) assertExists(toolName, versions, id, "地点");
  }
  if (refs.unitIds.size > 0) {
    const units = unitsAlready ?? (await storyUnitVersions(handle));
    for (const id of refs.unitIds) assertExists(toolName, units, id, "大纲单元");
  }
}

// ── 大纲层级形状预检（深度上限 + 场景末端；Write/Edit 共用） ──

/** 大纲层级深度上限（含根：全书=1 → 幕=2 → 幕=3 → 场景=4） */
const OUTLINE_MAX_DEPTH = 4;

/** 深度预检用的树节点最小形状 */
type OutlineUnitNode = { id: string; parentId?: string; scope?: string };

/** 全树拉取（深度预检用；比 storyUnitVersions 多取 parentId/scope） */
async function outlineUnitNodes(handle: NovelHandle): Promise<Map<string, OutlineUnitNode>> {
  const snap = (await handle.query({ op: "outline.get" })) as { units: OutlineUnitNode[] };
  return new Map(snap.units.map((u) => [u.id, u]));
}

/** 父链深度：顶层=1，逐层 +1；环/悬空截断（存在性由 assertExists 先行把关） */
function outlineDepthOf(byId: ReadonlyMap<string, OutlineUnitNode>, unitId: string): number {
  let depth = 0;
  let cursor: string | undefined = unitId;
  const seen = new Set<string>();
  while (cursor !== undefined && !seen.has(cursor)) {
    seen.add(cursor);
    depth++;
    cursor = byId.get(cursor)?.parentId;
  }
  return depth;
}

/** 层级形状检查项：unitId 缺省=新建；parentId undefined=不改挂靠（null=移到顶层） */
interface OutlineShapeCheck {
  unitId?: string;
  parentId?: string | null;
  scope?: string;
}

/**
 * 预检：大纲层级形状（≤4 层；场景是最底层不可挂子；换父按子树整体深度计）。
 * 深度含根（全书=1）；scene 父直接拒绝；Edit 把有子节点的单元改 scene 拒绝。
 */
function assertOutlineTreeShape(
  toolName: string,
  byId: ReadonlyMap<string, OutlineUnitNode>,
  checks: ReadonlyArray<OutlineShapeCheck>,
): void {
  const childrenOf = new Map<string, string[]>();
  for (const node of byId.values()) {
    if (node.parentId !== undefined) {
      const list = childrenOf.get(node.parentId) ?? [];
      list.push(node.id);
      childrenOf.set(node.parentId, list);
    }
  }
  const subtreeHeight = (root: string): number => {
    let height = 0;
    const stack: Array<[string, number]> = [[root, 0]];
    while (stack.length > 0) {
      const [id, level] = stack.pop()!;
      height = Math.max(height, level);
      for (const child of childrenOf.get(id) ?? []) stack.push([child, level + 1]);
    }
    return height;
  };
  for (const check of checks) {
    if (check.parentId !== undefined && check.parentId !== null) {
      const parent = byId.get(check.parentId);
      if (parent?.scope === "scene") {
        throw precheckFail(
          toolName,
          `大纲层级非法：场景单元已是最底层，不能再挂子单元——大纲最多 4 层（全书 → 幕 → 幕 → 场景），请在场景层横向扩展`,
        );
      }
    }
    if (check.parentId !== undefined) {
      const parentDepth =
        check.parentId !== null && byId.has(check.parentId) ? outlineDepthOf(byId, check.parentId) : 0;
      const baseDepth = parentDepth + 1;
      const extra = check.unitId !== undefined && byId.has(check.unitId) ? subtreeHeight(check.unitId) : 0;
      if (baseDepth + extra > OUTLINE_MAX_DEPTH) {
        throw precheckFail(
          toolName,
          `大纲层级超限：该操作会产生第 ${baseDepth + extra} 层——大纲最多 4 层（全书 → 幕 → 幕 → 场景），请横向拆分而非继续加深`,
        );
      }
    }
    if (check.unitId !== undefined && check.scope === "scene") {
      if ((childrenOf.get(check.unitId) ?? []).length > 0) {
        throw precheckFail(
          toolName,
          `大纲层级非法：该单元已有子单元，不能改为场景——场景是最底层（正文与 leaf 计划挂场景）`,
        );
      }
    }
  }
}

// ── kind 参数校验（合并工具的 kind 级收窄；扁平并集 schema 之上） ──

/** NovelRead 各 kind 允许的顶层参数（kind 之外） */
const READ_ALLOWED_PARAMS: Record<NovelKind | "overview", ReadonlySet<string>> = {
  overview: new Set<string>(),
  character: new Set(["characterId"]),
  location: new Set(["locationId"]),
  story_unit: new Set(["storyUnitId", "includePlans"]),
  paragraph: new Set(["paragraphId", "storyUnitId"]),
  volume: new Set<string>(),
  chapter: new Set(["chapterId", "volumeId", "includeContent"]),
};

/** NovelWrite 各 kind 的 values 项允许字段 */
const WRITE_ITEM_FIELDS: Record<NovelKind, ReadonlySet<string>> = {
  character: new Set(["id", "name", "aliases", "summary", "initialState", "authorNotes"]),
  location: new Set(["id", "name", "aliases", "summary", "initialState", "authorNotes"]),
  paragraph: new Set(["id", "storyUnitId", "orderKey", "text", "rhythm", "intensity"]),
  volume: new Set(["id", "title", "orderKey"]),
  chapter: new Set(["id", "volumeId", "title", "storyUnitId", "paragraphIds", "orderKey"]),
  story_unit: new Set([
    "id", "parentId", "orderKey", "title", "intent", "synopsis", "scope",
    "planningStatus", "realizationStatus", "blockState", "abandonment", "leaf",
  ]),
};

/** NovelWrite 各 kind 的 values 项必填字段（扁平并集 schema 无法表达，handler 校验） */
const WRITE_REQUIRED_FIELDS: Record<NovelKind, readonly string[]> = {
  character: ["name"],
  location: ["name"],
  paragraph: ["storyUnitId", "text", "rhythm"], // intensity 非字符串，必填与范围在 validateParagraphBeat 校验
  volume: ["title"],
  chapter: ["title"],
  story_unit: ["title"],
};

/** NovelEdit 各 kind 的 value 允许字段 */
const EDIT_VALUE_FIELDS: Record<NovelKind, ReadonlySet<string>> = {
  character: new Set(["name", "aliases", "summary", "initialState", "authorNotes"]),
  location: new Set(["name", "aliases", "summary", "initialState", "authorNotes"]),
  paragraph: new Set(["storyUnitId", "orderKey", "text", "rhythm", "intensity"]),
  volume: new Set(["title", "orderKey"]),
  chapter: new Set(["title", "orderKey", "volumeId", "paragraphIds"]),
  story_unit: new Set([
    "title", "intent", "synopsis", "scope", "planningStatus", "realizationStatus",
    "parentId", "orderKey", "blockState", "abandonment", "leaf",
  ]),
};

/** 校验 NovelRead 参数：kind 合法 + 顶层参数与 kind 匹配 */
function validateReadArgs(toolName: string, args: Record<string, unknown>): NovelKind | "overview" {
  const kind = args.kind;
  if (typeof kind !== "string" || kind.length === 0) {
    throw argsFail(
      toolName,
      "缺少必填参数 kind（character / location / story_unit / paragraph / volume / chapter / overview）",
    );
  }
  const allowed = READ_ALLOWED_PARAMS[kind as keyof typeof READ_ALLOWED_PARAMS];
  if (allowed === undefined) {
    throw argsFail(
      toolName,
      `未知 kind：${kind}（可选 character / location / story_unit / paragraph / volume / chapter / overview）`,
    );
  }
  for (const key of Object.keys(args)) {
    if (key !== "kind" && !allowed.has(key)) {
      throw argsFail(
        toolName,
        `kind=${kind} 不支持参数 ${key}（可用参数：${[...allowed].join(" / ") || "无"}）`,
      );
    }
  }
  return kind as NovelKind | "overview";
}

/** paragraph 节奏标注校验：rhythm 八档枚举 + intensity 1-5 整数（Write 必填；Edit 出现即校验） */
function validateParagraphBeat(
  toolName: string,
  v: Record<string, unknown>,
  required: boolean,
): void {
  if (required || v.rhythm !== undefined) {
    if (!LEAF_RHYTHMS.includes(v.rhythm as never)) {
      throw argsFail(toolName, `paragraph 的 rhythm 必须是 ${LEAF_RHYTHMS.join(" / ")} 之一`);
    }
  }
  if (required || v.intensity !== undefined) {
    const n = v.intensity;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 5) {
      throw argsFail(toolName, "paragraph 的 intensity 必填且必须是 1-5 的整数（情绪强度）");
    }
  }
}

/** 校验 NovelWrite 参数：kind 合法（无 overview）+ values 项字段与 kind 匹配 + 必填齐备 */
function validateWriteArgs(
  toolName: string,
  args: Record<string, unknown>,
): { kind: NovelKind; values: Record<string, unknown>[] } {
  const kind = args.kind;
  if (typeof kind !== "string" || WRITE_ITEM_FIELDS[kind as NovelKind] === undefined) {
    throw argsFail(
      toolName,
      "缺少或非法的 kind（可选 character / location / story_unit / paragraph / volume / chapter；overview 只读）",
    );
  }
  const values = valuesOf(args);
  if (values.length === 0) {
    throw argsFail(toolName, "values 不能为空（1-64 项）");
  }
  const allowed = WRITE_ITEM_FIELDS[kind as NovelKind];
  const required = WRITE_REQUIRED_FIELDS[kind as NovelKind];
  for (const v of values) {
    for (const key of Object.keys(v)) {
      if (!allowed.has(key)) {
        throw argsFail(
          toolName,
          `kind=${kind} 的 values 项不支持字段 ${key}（可用字段：${[...allowed].join(" / ")}）`,
        );
      }
    }
    for (const field of required) {
      const value = v[field];
      if (typeof value !== "string" || value.length === 0) {
        throw argsFail(toolName, `kind=${kind} 的 values 项缺少必填字段 ${field}`);
      }
    }
    if (kind === "paragraph") validateParagraphBeat(toolName, v, true);
  }
  return { kind: kind as NovelKind, values };
}

/** 校验 NovelEdit 参数：kind 合法 + 每项 {id, baseRevision, value} + value 字段与 kind 匹配 */
function validateEditArgs(
  toolName: string,
  args: Record<string, unknown>,
): { kind: NovelKind; items: Array<TargetedItem & { value: Record<string, unknown> }> } {
  const kind = args.kind;
  if (typeof kind !== "string" || EDIT_VALUE_FIELDS[kind as NovelKind] === undefined) {
    throw argsFail(
      toolName,
      "缺少或非法的 kind（可选 character / location / story_unit / paragraph / volume / chapter；overview 只读）",
    );
  }
  const items = valuesOf(args);
  if (items.length === 0) {
    throw argsFail(toolName, "values 不能为空（1-64 项）");
  }
  const allowed = EDIT_VALUE_FIELDS[kind as NovelKind];
  for (const item of items) {
    for (const key of Object.keys(item)) {
      if (key !== "id" && key !== "baseRevision" && key !== "value") {
        throw argsFail(toolName, `values 项不支持字段 ${key}（每项 = { id, baseRevision, value }）`);
      }
    }
    if (
      typeof item.id !== "string" ||
      item.id.length === 0 ||
      typeof item.baseRevision !== "number" ||
      typeof item.value !== "object" ||
      item.value === null
    ) {
      throw argsFail(toolName, "每项必须为 { id, baseRevision, value } 形状");
    }
    const value = item.value as Record<string, unknown>;
    for (const key of Object.keys(value)) {
      if (!allowed.has(key)) {
        throw argsFail(
          toolName,
          `kind=${kind} 的 value 不支持字段 ${key}（可用字段：${[...allowed].join(" / ")}）`,
        );
      }
    }
    if (kind === "paragraph") validateParagraphBeat(toolName, value, false);
  }
  return {
    kind: kind as NovelKind,
    items: items as unknown as Array<TargetedItem & { value: Record<string, unknown> }>,
  };
}

// ═══════════════ 工具组工厂（novel.entities：NovelRead/Write/Edit/Delete） ═══════════════

/**
 * 创建 novel 实体通用工具（kind 分发；组 novel.entities 的全部 4 件）
 * @param handle novel 客户端（query/mutate/mutateBatch）
 * @param options requireApproval 覆盖（缺省写工具需审批；后台无人审批会话——
 *   BookAnalyst——传 false，对齐 analyst.files 免审批先例）
 * @returns [NovelRead, NovelWrite, NovelEdit, NovelDelete]
 */
export function createNovelEntityTools(
	handle: NovelHandle,
	options?: { requireApproval?: boolean },
): ToolDef[] {
	const approval = options?.requireApproval ?? true;
	return [novelRead(handle), novelWrite(handle, approval), novelEdit(handle, approval), novelDelete(handle, approval)];
}

// ── NovelRead ──

function novelRead(handle: NovelHandle): ToolDef {
  return {
    name: "NovelRead",
    version: "1.0.0",
    preview: novelReadPreview,
    description: [
      "读取小说正式稿数据，只读。kind 必填选择实体类型；各 kind 用各自的 id 字段，传不适用参数直接报错。",
      "",
      "## 小说数据模型",
      "",
      "### 大纲（story_unit）",
      "整本书的结构真相源：全书 → 幕 → 场景的层级树（中间可有一层子幕），最多 4 层，最底层必须是能承载正文的场景级单元（须带完整 leaf 计划）。正文挂在它上面、发布从它取材、进度沿它滚动。每本书恰好一个大纲、自动存在；你读取与修改的是其中的故事单元（units 平铺返回，层级看 parentId，兄弟序看 orderKey）。",
      "层级深度硬限制：全书 → 一、（第 1 层幕）→ 1.1（第 2 层）→ 1.1.1（第 3 层，最深）；挂第 5 层或场景下挂子节点会被拒绝。",
      "双状态推进：planningStatus（idea→outlined→ready）管规划；realizationStatus（pending→in-progress→completed/abandoned）管写作；父单元进度由叶自动汇总，不手填。",
      "leaf 计划（场景级设计文档，挂最底层场景单元）：人物/地点绑定、事件序列、节奏拍、实体状态变更——写场景前先读 leaf 保证一致性。",
      "",
      "### 作者可见文本守则（务必遵守）",
      "- 指代大纲单元一律用「编号＋标题」双写：顶层幕「一、《觉醒之弧》」、更深层「1.1《雨夜觉醒》」。编号规则：兄弟按 orderKey 升序从 1 编号；顶层用中文序数（一、二、三…），其下用点分数字（一、=1，子层 1.1、1.2，再下 1.1.1）；序号段数即层级。编号是动态的（删改后重排），所以必须带标题。",
      "- 作者可见文本**不得出现任何内部标识**：saga/arc/sequence/scene、id、orderKey、entityVersion、leaf、story_unit 等词。id 与参数名只用于工具调用参数。",
      "- 汇报进展用**创作语言**：说「第一幕的大纲已拟好：主角在雨夜觉醒……」，不说「序列方案出来了」「结构化产出完成」这类工程语汇；**不自评质量**（如「质量很高」「完成度不错」）；不向作者解释内部机制与流程（读库、leaf、节奏拍、状态推进、发布组装等）。",
      "",
      "### 段落（paragraph）",
      "正文的唯一载体，挂在 scene 级单元上；不可变追加，修改走 NovelEdit。",
      "",
      "### 章（chapter）",
      "发布结构单元：按 paragraphIds 有序选择段落组装正文（可跨单元、可拆分/合并/重排）；volumeId 缺省=未归卷；storyUnitId 仅为来源提示（创建时可带，之后不可改）。",
      "",
      "### 卷（volume）",
      "发布结构容器，含章；发布结构根自动存在、无需创建。",
      "",
      "### 人物（character）/ 地点（location）",
      "档案实体（name/aliases/summary/initialState/authorNotes），本体没有任何关系字段——人物↔人物、人物↔地点的互相关联全部记录在 scene 的 leaf 计划里（绑定 + 实体状态变更），查关联要去读大纲。",
      "",
      "### 实体关联总览",
      "- story_unit → story_unit：parentId（树）、blockState.dependencyIds（依赖）、abandonment.replacementStoryUnitId（替换单元）",
      "- scene.leaf → 人物/地点：characters[].characterId（在场/参与）、locations[].locationId（主/次/提及）、entityChanges（entityId + relatedEntityId——人物↔人物、人物↔地点的关系演变只记在这里）",
      "- paragraph → story_unit：storyUnitId（挂靠）",
      "- chapter → volume（归卷）、→ paragraph（paragraphIds 有序选择）、→ story_unit（来源提示）",
      "- 无反向查询：查「某角色/地点出现在哪些场景」→ 读大纲（includePlans=true）后按 leaf 引用自行过滤。",
      "",
      "写作主线：大纲规划（story_unit）→ 场景设计（leaf）→ 写正文（paragraph 挂 scene）→ 发布组装（chapter 选段 + volume 归卷）。",
      "",
      "## 用法",
      "- overview：返回 { title, counts: { storyUnits, characters, locations, volumes, chapters, paragraphs } }——开卷、汇报进度先看总览。",
      "- character / location：省略 id 列出全部（含 id/name/entityVersion）；传 characterId / locationId 返回单个完整档案（aliases/summary/initialState/authorNotes）。",
      "- story_unit：省略 storyUnitId 返回全树平铺；传 storyUnitId 返回单个单元；includePlans=true 各单元附 leaf 计划与叶完成度 progress。",
      "- paragraph：传 paragraphId 返回单段；传 storyUnitId 返回该单元全部段落（orderKey 升序，各段附 rhythm/intensity 节奏标注）；都省略返回全部段落（按单元分组）。",
      "- volume：无参数，恒返回全部卷（id/title/orderKey，不含章）。",
      "- chapter：省略参数返回全部章；volumeId 过滤某卷；chapterId 只读该章；includeContent=true 附带每章按 paragraphIds 选择取回的正文段落。",
      "",
      "## 返回",
      "- 全部结果为 JSON。",
      "- 列表形态返回概要（id/name 或 id/title + entityVersion）；单实体形态返回完整档案。",
      "- entityVersion 是 NovelEdit / NovelDelete 所需 baseRevision 的唯一来源——修改/删除前先读。",
      "",
      "## 实例",
      "<example>",
      "作者：继续写",
      "→ NovelRead(kind=story_unit, includePlans=true)",
      "→ 从 progress 定位第一个未完成场景 → 读其 leaf → 按场景设计写正文",
      "<reasoning>先读树确认进度与结构现状，避免凭记忆臆造走向或重写已完成场景。</reasoning>",
      "</example>",
      "<example>",
      "作者：第二卷开头主角在哪？",
      "→ NovelRead(kind=story_unit) 全树 → 沿第二卷对应幕下各场景的 synopsis 与 leaf（地点绑定、实体变更）查证后回答",
      "<reasoning>时间线与人物位置必须查大纲而非凭记忆。</reasoning>",
      "</example>",
      "拿不准就读一次再动手。",
    ].join("\n"),
    parameters: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: ["overview", "character", "location", "story_unit", "paragraph", "volume", "chapter"],
          description: "实体类型（overview=全书总览；story_unit=大纲单元）",
        },
        characterId: { type: "string", description: "仅 character：角色 id（省略列全部）" },
        locationId: { type: "string", description: "仅 location：地点 id（省略列全部）" },
        storyUnitId: {
          type: "string",
          description: "story_unit：单元 id（省略返回全树）；paragraph：按单元过滤段落",
        },
        paragraphId: { type: "string", description: "仅 paragraph：段落 id" },
        chapterId: { type: "string", description: "仅 chapter：章 id" },
        volumeId: { type: "string", description: "仅 chapter：按卷过滤" },
        includeContent: { type: "boolean", description: "仅 chapter：附带章的正文来源段落" },
        includePlans: { type: "boolean", description: "仅 story_unit：附带 leaf 计划与叶完成度 rollup" },
      },
      required: ["kind"],
      additionalProperties: false,
    },
    promptDetail: {
      policy: "",
      guidance: "",
    },
    handler: {
      execute: async (call) => {
        const args = parseArgs(call);
        const kind = validateReadArgs(call.name, args);
        switch (kind) {
          case "overview": {
            const result = await handle.query({ op: "overview.get" });
            return JSON.stringify(result, null, 2);
          }
          case "character": {
            const id = args.characterId as string | undefined;
            const result = id
              ? await handle.query({ op: "characters.get", characterId: id as never })
              : await handle.query({ op: "characters.list" });
            return JSON.stringify(result, null, 2);
          }
          case "location": {
            const id = args.locationId as string | undefined;
            const result = id
              ? await handle.query({ op: "locations.get", locationId: id as never })
              : await handle.query({ op: "locations.list" });
            return JSON.stringify(result, null, 2);
          }
          case "story_unit": {
            const includePlans = args.includePlans === true;
            const r = args.storyUnitId
              ? await handle.query({ op: "outline.storyUnit.get", storyUnitId: args.storyUnitId as never, includePlans })
              : await handle.query({ op: "outline.get", includePlans });
            return JSON.stringify(r, null, 2);
          }
          case "paragraph": {
            const result = args.paragraphId
              ? await handle.query({ op: "paragraph.get", paragraphId: args.paragraphId as never })
              : await handle.query({ op: "paragraphs.list", storyUnitId: args.storyUnitId as never });
            return JSON.stringify(result, null, 2);
          }
          case "volume": {
            const snap = (await handle.query({ op: "publication.get" })) as {
              volumes: { id: string; title: string; orderKey: string }[];
            };
            return JSON.stringify(
              { volumes: snap.volumes.map((v) => ({ id: v.id, title: v.title, orderKey: v.orderKey })) },
              null,
              2,
            );
          }
          case "chapter": {
            const snap = (await handle.query({ op: "publication.get" })) as {
              chapters: { id: string; volumeId?: string; orderKey: string; title: string; storyUnitId?: string; entityVersion: number; paragraphIds?: string[] }[];
            };
            let chapters = snap.chapters;
            if (args.volumeId !== undefined) chapters = chapters.filter((c) => c.volumeId === args.volumeId);
            if (args.chapterId !== undefined) chapters = chapters.filter((c) => c.id === args.chapterId);
            if (args.includeContent === true) {
              const all = (await handle.query({ op: "paragraphs.list" })) as Array<{ id: string }>;
              const byId = new Map(all.map((p) => [p.id, p]));
              const enriched = chapters.map((c) => ({
                ...c,
                paragraphs: (c.paragraphIds ?? []).map((id) => byId.get(id)).filter((p) => p !== undefined),
              }));
              return JSON.stringify({ chapters: enriched }, null, 2);
            }
            return JSON.stringify({ chapters }, null, 2);
          }
        }
      },
    },
  };
}

// ── NovelWrite ──

/** NovelWrite 各 kind 预检（存在性 / id 占用 / 引用；审批提交前收口） */
async function precheckWrite(handle: NovelHandle, toolName: string, kind: NovelKind, values: Record<string, unknown>[]): Promise<void> {
  switch (kind) {
    case "character":
    case "location": {
      const withId = values.filter((v) => str(v.id) !== undefined);
      if (withId.length === 0) return;
      const versions = kind === "character" ? await characterVersions(handle) : await locationVersions(handle);
      for (const v of withId) assertIdFree(toolName, versions, str(v.id)!, KIND_LABELS[kind]);
      return;
    }
    case "paragraph": {
      if (values.length === 0) return;
      const [units, paras] = await Promise.all([
        values.some((v) => str(v.storyUnitId) !== undefined) ? storyUnitVersions(handle) : Promise.resolve(new Map<string, number>()),
        values.some((v) => str(v.id) !== undefined) ? paragraphVersions(handle) : Promise.resolve(new Map<string, number>()),
      ]);
      for (const v of values) {
        const unitId = str(v.storyUnitId);
        if (unitId !== undefined) assertExists(toolName, units, unitId, "大纲单元");
        const id = str(v.id);
        if (id !== undefined) assertIdFree(toolName, paras, id, "段落");
      }
      return;
    }
    case "volume": {
      const withId = values.filter((v) => str(v.id) !== undefined);
      if (withId.length === 0) return;
      const { volumes } = await publicationVersions(handle);
      for (const v of withId) assertIdFree(toolName, volumes, str(v.id)!, "卷");
      return;
    }
    case "chapter": {
      if (values.length === 0) return;
      const [pub, units, hasSelection] = await Promise.all([
        publicationVersions(handle),
        storyUnitVersions(handle),
        Promise.resolve(values.some((v) => Array.isArray(v.paragraphIds))),
      ]);
      const paras = hasSelection ? await paragraphVersions(handle) : new Map<string, number>();
      for (const v of values) {
        const vol = str(v.volumeId);
        if (vol !== undefined) assertExists(toolName, pub.volumes, vol, "卷");
        const unit = str(v.storyUnitId);
        if (unit !== undefined) assertExists(toolName, units, unit, "大纲单元");
        const id = str(v.id);
        if (id !== undefined) assertIdFree(toolName, pub.chapters, id, "章");
        if (Array.isArray(v.paragraphIds)) {
          for (const pid of v.paragraphIds) assertExists(toolName, paras, String(pid), "段落");
        }
      }
      return;
    }
    case "story_unit": {
      if (values.length === 0) return;
      const units = await storyUnitVersions(handle);
      for (const v of values) {
        const parent = str(v.parentId);
        if (parent !== undefined) assertExists(toolName, units, parent, "父大纲单元");
        const id = str(v.id);
        if (id !== undefined) assertIdFree(toolName, units, id, "大纲单元");
      }
      await assertReferencesExist(handle, toolName, collectReferences(values), units);
      assertOutlineTreeShape(
        toolName,
        await outlineUnitNodes(handle),
        values.map((v) => ({ parentId: str(v.parentId) ?? null, scope: str(v.scope) })),
      );
      return;
    }
  }
}

function novelWrite(handle: NovelHandle, requireApproval: boolean): ToolDef {
  return {
    name: "NovelWrite",
    version: "1.0.0",
    requireApproval,
    preview: novelWritePreview,
    description: [
      "批量创建实体、直接写入正式稿。kind 必填（无 overview——只读）；values 每项新建一个实体，整批原子（任一项失败整批回滚）；需作者审批；传不适用字段直接报错。",
      "数据模型见 NovelRead 的「小说数据模型」（写作主线：大纲规划 → 写正文 → 发布组装）。",
      "",
      "## 用法",
      "- character / location：name 必填；aliases 别名列表（≤32 项）；summary 摘要；initialState 初始状态；authorNotes 作者备注（不进正文）。不做重名校验——查重先 NovelRead。",
      "- paragraph：storyUnitId（推荐 scene 级单元，正文落在大纲树末端）+ text（一句一项——网文范式每句一段）+ rhythm（节奏档位八档之一）+ intensity（情绪强度 1-5）必填；orderKey 可选（4 位大写十六进制组，缺省排到该单元末尾）。rhythm/intensity 对齐场景节奏拍，是情绪曲线检查的数据源。",
      "- volume：title 必填（1-500 字）；orderKey 可选（缺省排到末卷之后）。",
      "- chapter：title 必填；volumeId 可选（缺省=未归卷）；paragraphIds 可选（章内段落有序选择，可跨单元、可拆分合并重排，引用段落须已存在，缺省空选择）；storyUnitId 仅来源提示（只在创建时可带）；orderKey 可选（同卷排序）。",
      "- story_unit：title 必填（1-500 字）；parentId 缺省=顶层（必须引用已存在单元——不能引用同批先建项，多层结构分批建）；**层级最多 4 层（全书→幕→幕→场景），最底层场景必须带完整 leaf 计划，场景下不得再挂子节点**；intent 单元意图；synopsis 情节梗概（数百字量级，勿塞正文）；scope 层级（saga/arc/sequence/scene/custom——仅作工具参数，不得出现在作者可见文本）；planningStatus / realizationStatus 缺省 idea / pending；blockState / abandonment / leaf 可随创建携带（leaf 引用的角色/地点 id 须已存在）。",
      "- 通用：id 可选自选（^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$，重复报 duplicate_id；id 仅作工具参数，不进作者可见文本）；本工具只新建，修改已有实体用 NovelEdit。建树自上而下分批：先建顶层幕拿到 id，再挂其下场景。",
      "",
      "## 返回",
      "items 形态：每项 { id: 变更id, status: \"applied\", version: 新 entityVersion }；自选 id 缺省由宿主生成并在结果回传；整批原子，任一项失败整批不落地。",
      "",
      "## 实例",
      "<example>",
      "作者：新书，都市异能，先搭第一卷",
      "→ NovelWrite(kind=story_unit, values=[{ title:\"觉醒之弧\", scope:\"arc\", intent:\"主角发现能力并卷入第一场冲突\", synopsis:\"……\" }])",
      "→ NovelWrite(kind=story_unit, values=[{ title:\"雨夜觉醒\", scope:\"scene\", parentId:<上批返回的 arc id>, synopsis:\"雨夜遇袭，能力觉醒\", leaf:{…} }])",
      "<reasoning>自上而下分批建树：顶层幕先落地拿到 id，场景再挂靠；场景设计随场景创建即挂上，后续写作有一致性约束可依。</reasoning>",
      "</example>",
    ].join("\n"),
    parameters: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: ["character", "location", "story_unit", "paragraph", "volume", "chapter"],
          description: "实体类型（story_unit=大纲单元；overview 只读不适用本工具）",
        },
        values: {
          type: "array",
          description: "要创建的实体列表（1-64 项；字段按 kind 取用，传不适用字段报错）",
          minItems: 1,
          maxItems: 64,
          items: {
            type: "object",
            properties: {
              id: { type: "string", pattern: ID_PATTERN, description: "自选 id（可选；缺省宿主生成）" },
              name: { type: "string", minLength: 1, maxLength: 200, description: "名字（character / location 必填）" },
              aliases: { type: "array", items: { type: "string", minLength: 1, maxLength: 200 }, maxItems: 32, description: "别名/称号列表（character / location）" },
              summary: { type: "string", maxLength: 20000, description: "摘要（character / location）" },
              initialState: { type: "string", maxLength: 20000, description: "初始状态（character / location）" },
              authorNotes: { type: "string", maxLength: 50000, description: "作者备注（character / location；不进正文）" },
              storyUnitId: { type: "string", pattern: ID_PATTERN, description: "paragraph：所属大纲单元（必填，推荐 scene 级）；chapter：来源提示（仅创建可带）" },
              orderKey: { type: "string", pattern: ORDER_KEY_PATTERN, description: "排序键（paragraph 段间 / volume 卷间 / chapter 同卷 / story_unit 兄弟间；缺省排到末尾）" },
              text: { type: "string", description: "段落完整正文（paragraph 必填；一句一项——网文范式每句一段）" },
              rhythm: {
                type: "string",
                enum: [...LEAF_RHYTHMS],
                description: "段落节奏档位（paragraph 必填；对齐场景节奏拍）：setup=铺垫 / rise=上升 / hold=维持 / turn=转折 / climax=高潮 / fall=回落 / release=释放 / aftermath=余波",
              },
              intensity: { type: "integer", minimum: 1, maximum: 5, description: "段落情绪强度（paragraph 必填）1-5，情绪曲线检查的数据源" },
              title: { type: "string", minLength: 1, maxLength: 500, description: "标题（volume / chapter / story_unit 必填）" },
              volumeId: { type: "string", pattern: ID_PATTERN, description: "所属卷 id（chapter；缺省 = 未归卷）" },
              paragraphIds: { type: "array", items: { type: "string", pattern: ID_PATTERN }, maxItems: 4096, description: "章内段落有序选择（chapter；可跨单元；引用段落须已存在）" },
              parentId: { type: "string", pattern: ID_PATTERN, description: "父单元 id（story_unit；缺省 = 顶层；不能引用同批先建项）" },
              intent: { type: "string", maxLength: 20000, description: "单元意图（story_unit）" },
              synopsis: { type: "string", maxLength: 50000, description: "情节梗概（story_unit；数百字量级，勿塞正文）" },
              scope: {
                type: "string",
                enum: ["saga", "arc", "sequence", "scene", "custom"],
                description: "层级作用域（story_unit）：saga=全书 / arc=叙事弧（跨度由故事节奏决定，与卷的划分无关） / sequence=序列 / scene=场景 / custom=自定义",
              },
              planningStatus: {
                type: "string",
                enum: ["idea", "outlined", "ready"],
                description: "规划状态（story_unit；缺省 idea）：idea=点子 / outlined=已成纲 / ready=可开写",
              },
              realizationStatus: {
                type: "string",
                enum: ["pending", "in-progress", "completed", "abandoned"],
                description: "实现状态（story_unit；缺省 pending）：pending=未动笔 / in-progress=写作中 / completed=已完成 / abandoned=已废弃",
              },
              blockState: blockStateSchema(false),
              abandonment: abandonmentSchema(false),
              leaf: {
                type: "object",
                description: "leaf 计划（story_unit；推荐挂 scene 叶单元；引用的角色/地点 id 须已存在）",
                properties: LEAF_PLAN_PROPERTIES,
                required: ["settingMode", "characters", "locations", "events", "rhythmBeats", "entityChanges"],
                additionalProperties: false,
              },
            },
            additionalProperties: false,
          },
        },
      },
      required: ["kind", "values"],
      additionalProperties: false,
    },
    promptDetail: {
      policy: "",
      guidance: "",
    },
    precheck: async (call) => {
      const { kind, values } = validateWriteArgs(call.name, parseArgs(call));
      await precheckWrite(handle, call.name, kind, values);
    },
    handler: {
      execute: async (call) => {
        const { kind, values } = validateWriteArgs(call.name, parseArgs(call));
        let mutations: unknown[];
        switch (kind) {
          case "character":
          case "location": {
            const op = kind === "character" ? "character.create" : "location.create";
            mutations = (values as unknown as Array<EntityInput & { id?: string }>).map((v) => ({
              op,
              id: v.id,
              input: { name: v.name, aliases: v.aliases, summary: v.summary, initialState: v.initialState, authorNotes: v.authorNotes },
            }));
            break;
          }
          case "paragraph": {
            mutations = (
              values as Array<{
                id?: string;
                storyUnitId: string;
                orderKey?: string;
                text: string;
                rhythm: (typeof LEAF_RHYTHMS)[number];
                intensity: number;
              }>
            ).map((v) => ({
              op: "paragraph.insert",
              id: v.id,
              storyUnitId: v.storyUnitId as never,
              orderKey: v.orderKey as OrderKey | undefined,
              text: v.text,
              rhythm: v.rhythm,
              intensity: v.intensity,
            }));
            break;
          }
          case "volume": {
            mutations = (values as Array<{ id?: string; title: string; orderKey?: string }>).map((v) => ({
              op: "publication.volume.create",
              id: v.id,
              title: v.title,
              orderKey: v.orderKey as OrderKey | undefined,
            }));
            break;
          }
          case "chapter": {
            mutations = (values as Array<{ id?: string; volumeId?: string; title: string; storyUnitId?: string; orderKey?: string; paragraphIds?: string[] }>).map((v) => ({
              op: "publication.chapter.create",
              id: v.id,
              volumeId: v.volumeId as never | undefined,
              title: v.title,
              storyUnitId: v.storyUnitId as never | undefined,
              orderKey: v.orderKey as OrderKey | undefined,
              paragraphIds: v.paragraphIds as never | undefined,
            }));
            break;
          }
          case "story_unit": {
            mutations = (values as Array<{
              id?: string;
              parentId?: string;
              orderKey?: string;
              title: string;
              intent?: string;
              synopsis?: string;
              scope?: string;
              planningStatus?: string;
              realizationStatus?: string;
              blockState?: unknown;
              abandonment?: unknown;
              leaf?: unknown;
            }>).map((v) => ({
              op: "outline.storyUnit.create",
              id: v.id,
              parentId: v.parentId as never | undefined,
              orderKey: v.orderKey as OrderKey | undefined,
              title: v.title,
              intent: v.intent,
              synopsis: v.synopsis,
              scope: v.scope as never,
              planningStatus: v.planningStatus as never,
              realizationStatus: v.realizationStatus as never,
              blockState: v.blockState as never,
              abandonment: v.abandonment as never,
              leaf: v.leaf as never,
            }));
            break;
          }
        }
        const results = await handle.mutateBatch(mutations as never[]);
        return formatBatchItems(results);
      },
    },
  };
}

// ── NovelEdit ──

/** NovelEdit 各 kind 预检（乐观锁 + 引用存在性；审批提交前收口） */
async function precheckEdit(
  handle: NovelHandle,
  toolName: string,
  kind: NovelKind,
  items: Array<TargetedItem & { value?: Record<string, unknown> }>,
): Promise<void> {
  switch (kind) {
    case "character":
    case "location": {
      if (items.length === 0) return;
      const versions = kind === "character" ? await characterVersions(handle) : await locationVersions(handle);
      for (const item of items) assertRevision(toolName, versions, item.id, item.baseRevision, KIND_LABELS[kind]);
      return;
    }
    case "paragraph": {
      if (items.length === 0) return;
      const paras = await paragraphVersions(handle);
      const units = await storyUnitVersions(handle);
      for (const item of items) {
        assertRevision(toolName, paras, item.id, item.baseRevision, "段落");
        const target = str(item.value?.storyUnitId);
        if (target !== undefined) assertExists(toolName, units, target, "大纲单元");
      }
      return;
    }
    case "volume": {
      if (items.length === 0) return;
      const { volumes } = await publicationVersions(handle);
      for (const item of items) assertRevision(toolName, volumes, item.id, item.baseRevision, "卷");
      return;
    }
    case "chapter": {
      if (items.length === 0) return;
      const { volumes, chapters } = await publicationVersions(handle);
      const needParas = items.some((item) => Array.isArray(item.value?.paragraphIds));
      const paras = needParas ? await paragraphVersions(handle) : new Map<string, number>();
      for (const item of items) {
        assertRevision(toolName, chapters, item.id, item.baseRevision, "章");
        const vol = str(item.value?.volumeId);
        if (vol !== undefined) assertExists(toolName, volumes, vol, "卷");
        if (Array.isArray(item.value?.paragraphIds)) {
          for (const pid of item.value.paragraphIds as unknown[]) {
            assertExists(toolName, paras, String(pid), "段落");
          }
        }
      }
      return;
    }
    case "story_unit": {
      if (items.length === 0) return;
      const units = await storyUnitVersions(handle);
      for (const item of items) {
        assertRevision(toolName, units, item.id, item.baseRevision, "大纲单元");
        const parent = str(item.value?.parentId);
        if (parent !== undefined) assertExists(toolName, units, parent, "父大纲单元");
      }
      await assertReferencesExist(handle, toolName, collectReferences(items.map((i) => i.value)), units);
      assertOutlineTreeShape(
        toolName,
        await outlineUnitNodes(handle),
        items.map((item) => ({
          unitId: item.id,
          parentId: item.value?.parentId === undefined ? undefined : (item.value.parentId as string | null),
          scope: str(item.value?.scope),
        })),
      );
      return;
    }
  }
}

function novelEdit(handle: NovelHandle, requireApproval: boolean): ToolDef {
  return {
    name: "NovelEdit",
    version: "1.0.0",
    preview: novelEditPreview,
    requireApproval,
    description: [
      "批量局部更新（PATCH）已有实体。kind 必填（无 overview）；每项 = { id, baseRevision, value }，整批原子；需作者审批。",
      "数据模型见 NovelRead 的「小说数据模型」。",
      "",
      "## 用法",
      "- value 只传要改的字段，未提供的保留原值。各 kind 可改字段：",
      "  - character / location：name；aliases（全量替换，[] 即清空）；summary / initialState / authorNotes（null 清空）。",
      "  - paragraph：text（替换后的完整段落文本，非增量片段）；storyUnitId（移动到另一单元）；orderKey（重排）。",
      "  - volume：title；orderKey。",
      "  - chapter：title；orderKey；volumeId（调整归卷）；paragraphIds（全量替换有序选择——拆分/合并/重排/跨单元/中途收章都靠它，null 清空，引用段落须已存在）。来源提示 storyUnitId 创建后不可改。",
      "  - story_unit：title；intent；synopsis；scope（把已有子节点的单元改为 scene 会被拒绝）；planningStatus；realizationStatus；parentId（换父，null=移到顶层；新位置超 4 层或挂到场景下会被拒绝）；orderKey（兄弟重排）；blockState（null 清除）；abandonment（null 清除）；leaf（null 删整个计划；字段级替换，集合字段传 null 清空）。",
      "",
      "## 返回",
      "items 形态（同 NovelWrite：变更 id + applied + 新 entityVersion）；baseRevision 预检过期时整批拒绝并附当前版本——重读后再提交，勿原样重试。",
      "",
      "## 实例",
      "<example>",
      "一个场景写完，开写下一个：",
      "→ NovelEdit(kind=story_unit, values=[",
      "  { id:<scene-A>, baseRevision:<v>, value:{ realizationStatus:\"completed\" } },",
      "  { id:<scene-B>, baseRevision:<v>, value:{ realizationStatus:\"in-progress\", planningStatus:\"ready\" } } ])",
      "<reasoning>写完立即标 completed、下一个标 in-progress；父幕与全书进度由叶单元自动汇总，不手动改父单元。</reasoning>",
      "</example>",
      "写/改正文用 kind=paragraph，不入大纲字段。先读后改。",
    ].join("\n"),
    parameters: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: ["character", "location", "story_unit", "paragraph", "volume", "chapter"],
          description: "实体类型（story_unit=大纲单元；overview 只读不适用本工具）",
        },
        values: {
          type: "array",
          description: "要更新的实体列表（1-64 项：目标 + 乐观锁版本 + 补丁；value 字段按 kind 取用）",
          minItems: 1,
          maxItems: 64,
          items: {
            type: "object",
            properties: {
              id: { type: "string", pattern: ID_PATTERN, description: "目标实体 id" },
              baseRevision: { type: "integer", description: "最近读到的该实体 entityVersion（乐观锁）" },
              value: {
                type: "object",
                description: "要修改的字段（未提供的保留原值；字段按 kind 取用）",
                properties: {
                  name: { type: "string", minLength: 1, maxLength: 200, description: "名字（覆盖；character / location）" },
                  aliases: { type: "array", items: { type: "string", minLength: 1, maxLength: 200 }, maxItems: 32, description: "全量替换别名列表（[] 即清空；character / location）" },
                  summary: { type: ["string", "null"], maxLength: 20000, description: "摘要（null 清空；character / location）" },
                  initialState: { type: ["string", "null"], maxLength: 20000, description: "初始状态（null 清空；character / location）" },
                  authorNotes: { type: ["string", "null"], maxLength: 50000, description: "作者备注（null 清空；character / location）" },
                  storyUnitId: { type: "string", pattern: ID_PATTERN, description: "移动到该大纲单元（仅 paragraph；章的来源提示不可改）" },
                  orderKey: { type: "string", pattern: ORDER_KEY_PATTERN, description: "重排序（paragraph 段间 / volume 卷间 / chapter 同卷 / story_unit 兄弟间）" },
                  text: { type: "string", description: "替换后的完整段落文本（仅 paragraph；一句一项——网文范式每句一段）" },
                  rhythm: { type: "string", enum: [...LEAF_RHYTHMS], description: "改段落节奏档位（仅 paragraph；八档同场景节奏拍）" },
                  intensity: { type: "integer", minimum: 1, maximum: 5, description: "改段落情绪强度（仅 paragraph）1-5" },
                  title: { type: "string", minLength: 1, maxLength: 500, description: "标题（覆盖；volume / chapter / story_unit）" },
                  volumeId: { type: "string", pattern: ID_PATTERN, description: "所属卷 id（仅 chapter；调整归卷）" },
                  paragraphIds: { type: ["array", "null"], items: { type: "string", pattern: ID_PATTERN }, maxItems: 4096, description: "全量替换有序段落选择（仅 chapter；null 清空；引用段落须已存在）" },
                  intent: { type: "string", maxLength: 20000, description: "单元意图（仅 story_unit）" },
                  synopsis: { type: "string", maxLength: 50000, description: "情节梗概（仅 story_unit）" },
                  scope: { type: "string", enum: ["saga", "arc", "sequence", "scene", "custom"], description: "层级作用域（仅 story_unit）" },
                  planningStatus: { type: "string", enum: ["idea", "outlined", "ready"], description: "规划状态（仅 story_unit）" },
                  realizationStatus: { type: "string", enum: ["pending", "in-progress", "completed", "abandoned"], description: "实现状态（仅 story_unit）" },
                  parentId: { type: ["string", "null"], pattern: ID_PATTERN, description: "换父节点（仅 story_unit；null = 移到顶层）" },
                  blockState: blockStateSchema(true),
                  abandonment: abandonmentSchema(true),
                  leaf: {
                    type: ["object", "null"],
                    description: "leaf 计划补丁（仅 story_unit；null 清整个计划；字段级替换，集合字段传 null 清空）",
                    properties: nullableProps(LEAF_PLAN_PROPERTIES, ["settingMode"]),
                    additionalProperties: false,
                  },
                },
                additionalProperties: false,
              },
            },
            required: ["id", "baseRevision", "value"],
            additionalProperties: false,
          },
        },
      },
      required: ["kind", "values"],
      additionalProperties: false,
    },
    promptDetail: {
      policy: "",
      guidance: "",
    },
    precheck: async (call) => {
      const { kind, items } = validateEditArgs(call.name, parseArgs(call));
      await precheckEdit(handle, call.name, kind, items);
    },
    handler: {
      execute: async (call) => {
        const { kind, items } = validateEditArgs(call.name, parseArgs(call));
        let mutations: unknown[];
        switch (kind) {
          case "character":
          case "location": {
            const op = kind === "character" ? "character.update" : "location.update";
            const idField = kind === "character" ? "characterId" : "locationId";
            mutations = (items as unknown as Array<TargetedItem & { value: Partial<EntityInput> }>).map((v) => ({
              op,
              [idField]: v.id as never,
              baseRevision: v.baseRevision,
              patch: v.value,
            }));
            break;
          }
          case "paragraph": {
            mutations = (
              items as unknown as Array<
                TargetedItem & {
                  value: {
                    text?: string;
                    storyUnitId?: string;
                    orderKey?: string;
                    rhythm?: (typeof LEAF_RHYTHMS)[number];
                    intensity?: number;
                  };
                }
              >
            ).map((v) => ({
              op: "paragraph.update",
              paragraphId: v.id as never,
              baseRevision: v.baseRevision,
              text: v.value.text,
              storyUnitId: v.value.storyUnitId as never | undefined,
              orderKey: v.value.orderKey as OrderKey | undefined,
              rhythm: v.value.rhythm,
              intensity: v.value.intensity,
            }));
            break;
          }
          case "volume": {
            mutations = (items as unknown as Array<TargetedItem & { value: { title?: string; orderKey?: string } }>).map((v) => ({
              op: "publication.volume.update",
              volumeId: v.id as never,
              baseRevision: v.baseRevision,
              patch: v.value as never,
            }));
            break;
          }
          case "chapter": {
            mutations = (items as unknown as Array<TargetedItem & { value: Record<string, unknown> }>).map((v) => ({
              op: "publication.chapter.update",
              chapterId: v.id as never,
              baseRevision: v.baseRevision,
              patch: v.value as never,
            }));
            break;
          }
          case "story_unit": {
            mutations = (items as unknown as Array<TargetedItem & { value: Record<string, unknown> }>).map((v) => ({
              op: "outline.storyUnit.update",
              storyUnitId: v.id as never,
              baseRevision: v.baseRevision,
              patch: v.value as never,
            }));
            break;
          }
        }
        const results = await handle.mutateBatch(mutations as never[]);
        return formatBatchItems(results);
      },
    },
  };
}

// ── NovelDelete ──

function novelDelete(handle: NovelHandle, requireApproval: boolean): ToolDef {
  return {
    name: "NovelDelete",
    version: "1.0.0",
    preview: novelDeletePreview,
    requireApproval,
    description: [
      "批量删除小说实体（高风险，不可恢复；整批原子）。",
      "",
      "用法：",
      "- 顶层 cascade（缺省 false）+ values 每项 = { kind, id, baseRevision }。",
      "- kind ∈ story_unit / character / location / paragraph / volume / chapter。",
      "- baseRevision：该实体最近一次读到的 entityVersion（审批前预检，过期直接拒绝并附当前版本）。",
      "- 依赖检查（cascade=false 默认拒绝）：story unit 有子单元/leaf 计划/段落、卷有章、章有段落选择——均直接拒绝并列出依赖。",
      "- character / location 被任何 scene 的 leaf 引用（绑定/实体变更）时直接拒绝并列出引用单元——先用 NovelEdit 清理引用后再删；cascade 不豁免此检查（正文文本提及名字不算引用）。",
      "- cascade=true 级联：story unit 删整个子树（单元 + leaf 计划 + 段落及其章选择）、卷删其章（含各自选择，段落保留）、章解绑段落选择（段落保留）；删除段落会同时从所有章选择移除。",
      "- 返回 items + deleted[]（实际删除的每个实体完整记录，级联展开、跨批去重）。",
      "- 调用前先读（NovelRead）确认目标与版本，并向用户确认后再执行（谨慎行动）。",
    ].join("\n"),
    parameters: {
      type: "object",
      properties: {
        cascade: {
          type: "boolean",
          description: "级联删除（缺省 false）：true 时 story unit 删整个子树、卷删其章、章解绑选择",
        },
        values: {
          type: "array",
          description: "要删除的实体列表（1-64 项：类型 + id + 乐观锁版本）",
          minItems: 1,
          maxItems: 64,
          items: {
            type: "object",
            properties: {
              kind: {
                type: "string",
                enum: ["story_unit", "character", "location", "paragraph", "volume", "chapter"],
                description: "实体类型（story_unit=大纲单元 / character=角色 / location=地点 / paragraph=段落 / volume=卷 / chapter=章）",
              },
              id: { type: "string", pattern: ID_PATTERN, description: "目标实体 id" },
              baseRevision: { type: "integer", description: "最近读到的该实体 entityVersion（乐观锁）" },
            },
            required: ["kind", "id", "baseRevision"],
            additionalProperties: false,
          },
        },
      },
      required: ["values"],
      additionalProperties: false,
    },
    promptDetail: {
      policy: "",
      guidance: "",
    },
    precheck: async (call) => {
      const args = parseArgs(call);
      const items = valuesOf(args) as unknown as Array<TargetedItem & { kind: string }>;
      if (items.length === 0) return;
      const kinds = new Set(items.map((v) => v.kind));
      const labels: Record<string, string> = {
        story_unit: "大纲单元",
        character: "角色",
        location: "地点",
        paragraph: "段落",
        volume: "卷",
        chapter: "章",
      };
      const indexes = new Map<string, Promise<VersionIndex>>();
      const indexOf = (kind: string): Promise<VersionIndex> => {
        let p = indexes.get(kind);
        if (p === undefined) {
          p = (async () => {
            switch (kind) {
              case "story_unit":
                return storyUnitVersions(handle);
              case "character":
                return characterVersions(handle);
              case "location":
                return locationVersions(handle);
              case "paragraph":
                return paragraphVersions(handle);
              case "volume":
                return (await publicationVersions(handle)).volumes;
              case "chapter":
                return (await publicationVersions(handle)).chapters;
              default:
                return new Map<string, number>();
            }
          })();
          indexes.set(kind, p);
        }
        return p;
      };
      for (const item of items) {
        const versions = await indexOf(item.kind);
        assertRevision(call.name, versions, item.id, item.baseRevision, labels[item.kind] ?? item.kind);
      }
      // leaf 引用检查（悬空引用防护；cascade 不豁免——结构性级联之外，档案引用须显式清理）
      const entityTargets = items.filter((v) => v.kind === "character" || v.kind === "location");
      if (entityTargets.length > 0) {
        const snap = (await handle.query({ op: "outline.get", includePlans: true })) as {
          units: Array<{ id: string; leaf?: unknown }>;
        };
        const refIndex = new Map<string, Set<string>>();
        const addRef = (target: unknown, unitId: string): void => {
          if (typeof target === "string" && target.length > 0) {
            let set = refIndex.get(target);
            if (set === undefined) {
              set = new Set<string>();
              refIndex.set(target, set);
            }
            set.add(unitId);
          }
        };
        for (const unit of snap.units ?? []) {
          const leaf = unit.leaf;
          if (leaf === undefined || leaf === null || typeof leaf !== "object") continue;
          const l = leaf as Record<string, unknown>;
          for (const c of Array.isArray(l.characters) ? l.characters : []) {
            addRef((c as Record<string, unknown>)?.characterId, unit.id);
          }
          for (const loc of Array.isArray(l.locations) ? l.locations : []) {
            addRef((loc as Record<string, unknown>)?.locationId, unit.id);
          }
          for (const e of Array.isArray(l.entityChanges) ? l.entityChanges : []) {
            const rec = e as Record<string, unknown>;
            addRef(rec?.entityId, unit.id);
            addRef(rec?.relatedEntityId, unit.id);
          }
        }
        for (const item of entityTargets) {
          const refs = refIndex.get(item.id);
          if (refs !== undefined && refs.size > 0) {
            throw precheckFail(
              call.name,
              `${labels[item.kind]} ${item.id} 被 leaf 引用（场景单元 ${[...refs].join(" / ")}）——先用 NovelEdit 清理对应 leaf 绑定/实体变更后再删除`,
            );
          }
        }
      }
      // 依赖检查（PRD §4-11）：cascade=false 时默认拒绝有依赖的删除
      if (args.cascade === true) return;
      const depKinds = new Set(items.map((v) => v.kind));
      const needUnits = depKinds.has("story_unit");
      const needParas = depKinds.has("paragraph") || needUnits;
      const needPub = depKinds.has("volume") || depKinds.has("chapter");
      const [unitsSnap, parasSnap, pubSnap] = await Promise.all([
        needUnits ? handle.query({ op: "outline.get", includePlans: true }) : Promise.resolve(undefined),
        needParas ? handle.query({ op: "paragraphs.list" }) : Promise.resolve(undefined),
        needPub ? handle.query({ op: "publication.get" }) : Promise.resolve(undefined),
      ]);
      const units = (unitsSnap as { units: Array<{ id: string; parentId?: string; leaf?: unknown }> } | undefined)?.units ?? [];
      const paras = (parasSnap as Array<{ id: string; storyUnitId: string }> | undefined) ?? [];
      const chapters = (pubSnap as { chapters: Array<{ id: string; volumeId?: string; paragraphIds?: string[] }> } | undefined)?.chapters ?? [];
      for (const item of items) {
        if (item.kind === "story_unit") {
          const childCount = units.filter((u) => u.parentId === item.id).length;
          const hasLeaf = units.find((u) => u.id === item.id)?.leaf !== undefined;
          const paraCount = paras.filter((p) => p.storyUnitId === item.id).length;
          if (childCount > 0 || hasLeaf || paraCount > 0) {
            const deps = [
              childCount > 0 ? `${childCount} 个子单元` : "",
              hasLeaf ? "leaf 计划" : "",
              paraCount > 0 ? `${paraCount} 个段落` : "",
            ].filter(Boolean).join(" / ");
            throw precheckFail(call.name, `大纲单元 ${item.id} 有依赖（${deps}）——需 cascade:true 级联删除`);
          }
        } else if (item.kind === "volume") {
          const chapterCount = chapters.filter((c) => c.volumeId === item.id).length;
          if (chapterCount > 0) {
            throw precheckFail(call.name, `卷 ${item.id} 仍含 ${chapterCount} 章——需 cascade:true 级联删除`);
          }
        } else if (item.kind === "chapter") {
          const selection = chapters.find((c) => c.id === item.id)?.paragraphIds ?? [];
          if (selection.length > 0) {
            throw precheckFail(call.name, `章 ${item.id} 仍有 ${selection.length} 个段落选择——需 cascade:true（级联仅解绑选择）或先清空选择`);
          }
        }
      }
    },
    handler: {
      execute: async (call) => {
        const args = parseArgs(call);
        const cascade = args.cascade === true;
        const values = (args.values as Array<{ kind: string; id: string; baseRevision: number }>) ?? [];
        const results = await handle.mutateBatch(
          values.map((v) => {
            const op = `${kindToOp(v.kind)}.delete` as const;
            const withCascade = cascade && (v.kind === "story_unit" || v.kind === "volume" || v.kind === "chapter");
            return {
              op,
              baseRevision: v.baseRevision,
              ...(withCascade ? { cascade: true } : {}),
              ...({ [kindToIdField(v.kind)]: v.id } as Record<string, unknown>),
            } as never;
          }),
        );
        // 跨批去重汇总被删实体完整记录（级联展开）
        const seen = new Set<string>();
        const deleted: Array<{ kind: string; id: string; data: unknown }> = [];
        for (const r of results) {
          for (const d of r.deleted ?? []) {
            const key = `${d.kind}:${d.id}`;
            if (!seen.has(key)) {
              seen.add(key);
              deleted.push(d);
            }
          }
        }
        return JSON.stringify(
          {
            items: results.map((r) => ({ id: r.changeId, status: "applied", version: r.version })),
            ...(deleted.length > 0 ? { deleted } : {}),
          },
          null,
          2,
        );
      },
    },
  };
}

/** delete kind → mutation op 前缀 */
function kindToOp(kind: string): string {
  switch (kind) {
    case "story_unit":
      return "outline.storyUnit";
    case "paragraph":
      return "paragraph";
    case "volume":
      return "publication.volume";
    case "chapter":
      return "publication.chapter";
    default:
      return kind; // character / location
  }
}

/** delete kind → id 字段名 */
function kindToIdField(kind: string): string {
  switch (kind) {
    case "story_unit":
      return "storyUnitId";
    case "volume":
      return "volumeId";
    case "chapter":
      return "chapterId";
    default:
      return `${kind}Id`; // characterId / locationId / paragraphId
  }
}
