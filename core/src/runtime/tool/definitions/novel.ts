/**
 * novel 域工具（P1 对齐 legacy-main 契约，PRD docs/PRD/novel-tools-legacy-对齐.md）。
 *
 * - 命名：19 件 Novel* 工具（Volume/Chapter 拆分六件套），compose 两件套不在本文件。
 * - 形状：Write `{ values:[{id?,...}] }`（1-64 项，id 可自选，重复 duplicate_id）；
 *   Edit `{ values:[{id, baseRevision, value}] }`；Delete `{ values:[{kind,id,baseRevision}] }`。
 * - 约束：ID_PATTERN / ORDER_KEY_PATTERN（hex 4 位组）+ 字段长度/数量上限（legacy 同款）。
 * - 预检：precheck 在审批请求提交前校验存在性/乐观锁/id 占用（失败不进审批）。
 * - 原子：写批经 mutateBatch 单事务执行，任一项失败整批回滚。
 * - 描述：中文详述（口径：schema 对齐 legacy、描述保留中文）。
 */
import type { ToolDef } from "../ToolDef.js";
import type { ToolCall } from "../../provider/types.js";
import type { NovelHandle } from "../../../novel/client/NovelHandle.js";
import type { NovelMutateResult } from "../../../novel/contract/snapshot.js";
import type { OrderKey } from "../../../novel/model/outline.js";
import { ID_PATTERN, ORDER_KEY_PATTERN } from "../../../novel/keys.js";
import {
  characterReadPreview,
  characterWritePreview,
  characterEditPreview,
  locationReadPreview,
  locationWritePreview,
  locationEditPreview,
  paragraphReadPreview,
  paragraphWritePreview,
  paragraphEditPreview,
  novelDeletePreview,
  outlineReadPreview,
  outlineWritePreview,
  outlineEditPreview,
  volumeReadPreview,
  volumeWritePreview,
  volumeEditPreview,
  chapterReadPreview,
  chapterWritePreview,
  chapterEditPreview,
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

/** values 数组解析（缺省空数组） */
function valuesOf(args: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(args.values) ? (args.values as Record<string, unknown>[]) : [];
}

/** string 字段读取（缺省 undefined） */
function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
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
          enum: ["setup", "rise", "hold", "turn", "climax", "fall", "release", "aftermath"],
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

// ═══════════════ character ═══════════════

/**
 * 创建 character 工具（Read/Write/Edit），handler 对接 NovelHandle
 * @param handle novel 客户端（query/mutate/mutateBatch）
 * @returns 角色工具定义
 */
export function createCharacterTools(handle: NovelHandle): ToolDef[] {
  return [characterRead(handle), characterWrite(handle), characterEdit(handle)];
}

function characterRead(handle: NovelHandle): ToolDef {
  return {
    name: "NovelCharacterRead",
    version: "1.0.0",
    preview: characterReadPreview,
    description: [
      "读取角色档案（正式稿），只读。",
      "",
      "用法：",
      "- 省略 characterId：返回全部角色（含 id / name / entityVersion）。",
      "- 传入 characterId：返回单个角色完整档案（aliases / summary / initialState / authorNotes）。",
      "- 返回的 entityVersion 是 NovelCharacterEdit / NovelDelete 所需 baseRevision 的来源；修改前先 Read 拿最新版本。",
    ].join("\n"),
    parameters: {
      type: "object",
      properties: {
        characterId: { type: "string", description: "角色 id（省略则列出全部角色）" },
      },
      additionalProperties: false,
    },
    promptDetail: {
      policy: "Reads committed (canonical) Character profiles; use it before any NovelCharacterEdit or NovelDelete on a character.",
      guidance:
        "Omit characterId to list all. The returned entityVersion is the baseRevision later edits and deletes must carry; stale revisions are rejected before approval.",
    },
    handler: {
      execute: async (call) => {
        const args = parseArgs(call);
        const id = args.characterId as string | undefined;
        const result = id
          ? await handle.query({ op: "characters.get", characterId: id as never })
          : await handle.query({ op: "characters.list" });
        return JSON.stringify(result, null, 2);
      },
    },
  };
}

function characterWrite(handle: NovelHandle): ToolDef {
  return {
    name: "NovelCharacterWrite",
    version: "1.0.0",
    requireApproval: true,
    preview: characterWritePreview,
    description: [
      "批量创建角色档案，直接写入正式稿（values 每项新建一个角色，整批原子：任一项失败整批不落地）。",
      "",
      "用法：",
      "- name 必填；不做重名校验（重名会各自独立建档，查重先 NovelCharacterRead）。",
      "- id 可选：客户端自选 id（须匹配 ^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$，重复报 duplicate_id）；缺省宿主生成并在结果回传。",
      "- aliases：别名/称号列表（≤32 项）；summary：一句话人物摘要。",
      "- initialState：出场时的状态设定；authorNotes：作者私有备注（不进正文）。",
      "- 只新建、不更新已有角色；修改已有角色用 NovelCharacterEdit。",
    ].join("\n"),
    parameters: {
      type: "object",
      properties: {
        values: {
          type: "array",
          description: "要创建的角色列表（1-64 项，每项一个角色）",
          minItems: 1,
          maxItems: 64,
          items: {
            type: "object",
            properties: {
              id: { type: "string", pattern: ID_PATTERN, description: "自选 id（可选；缺省宿主生成）" },
              name: { type: "string", minLength: 1, maxLength: 200, description: "角色名（必填）" },
              aliases: { type: "array", items: { type: "string", minLength: 1, maxLength: 200 }, maxItems: 32, description: "别名/称号列表（可选）" },
              summary: { type: "string", maxLength: 20000, description: "人物摘要（可选）" },
              initialState: { type: "string", maxLength: 20000, description: "出场时的初始状态（可选）" },
              authorNotes: { type: "string", maxLength: 50000, description: "作者备注（可选）" },
            },
            required: ["name"],
            additionalProperties: false,
          },
        },
      },
      required: ["values"],
      additionalProperties: false,
    },
    promptDetail: {
      policy: "Batch-creates Character profiles in the canonical store (atomic per batch).",
      guidance:
        "name is required and not uniqueness-checked — list first to avoid duplicates. id is optional (client-chosen, duplicate_id rejected). To change an existing profile use NovelCharacterEdit, not Write.",
    },
    precheck: async (call) => {
      const values = valuesOf(parseArgs(call));
      const withId = values.filter((v) => str(v.id) !== undefined);
      if (withId.length === 0) return;
      const versions = await characterVersions(handle);
      for (const v of withId) assertIdFree(call.name, versions, str(v.id)!, "角色");
    },
    handler: {
      execute: async (call) => {
        const values = valuesOf(parseArgs(call)) as unknown as Array<EntityInput & { id?: string }>;
        const results = await handle.mutateBatch(
          values.map((v) => ({ op: "character.create" as const, id: v.id, input: { name: v.name, aliases: v.aliases, summary: v.summary, initialState: v.initialState, authorNotes: v.authorNotes } })),
        );
        return formatBatchItems(results);
      },
    },
  };
}

function characterEdit(handle: NovelHandle): ToolDef {
  return {
    name: "NovelCharacterEdit",
    version: "1.0.0",
    preview: characterEditPreview,
    requireApproval: true,
    description: [
      "批量局部更新（PATCH）已有角色档案，整批原子。",
      "",
      "用法：",
      "- 每项 = { id, baseRevision, value }。",
      "- baseRevision：最近一次 NovelCharacterRead 读到的该角色 entityVersion（审批前预检，过期直接拒绝并附当前版本）。",
      "- value 只传要改的字段，未提供的字段保留原值。",
      "- 清空语义：summary / initialState / authorNotes 传 null 清空；aliases 传 [] 清空。",
    ].join("\n"),
    parameters: {
      type: "object",
      properties: {
        values: {
          type: "array",
          description: "要更新的角色列表（1-64 项：目标 + 乐观锁版本 + 补丁）",
          minItems: 1,
          maxItems: 64,
          items: {
            type: "object",
            properties: {
              id: { type: "string", pattern: ID_PATTERN, description: "目标角色 id" },
              baseRevision: { type: "integer", description: "最近读到的该角色 entityVersion（乐观锁）" },
              value: {
                type: "object",
                description: "要修改的字段（未提供的保留原值）",
                properties: {
                  name: { type: "string", minLength: 1, maxLength: 200, description: "新角色名（覆盖）" },
                  aliases: { type: "array", items: { type: "string", minLength: 1, maxLength: 200 }, maxItems: 32, description: "全量替换别名列表（[] 即清空）" },
                  summary: { type: ["string", "null"], maxLength: 20000, description: "摘要（null 清空）" },
                  initialState: { type: ["string", "null"], maxLength: 20000, description: "初始状态（null 清空）" },
                  authorNotes: { type: ["string", "null"], maxLength: 50000, description: "作者备注（null 清空）" },
                },
                additionalProperties: false,
              },
            },
            required: ["id", "baseRevision", "value"],
            additionalProperties: false,
          },
        },
      },
      required: ["values"],
      additionalProperties: false,
    },
    promptDetail: {
      policy: "Batch field-level partial updates (PATCH) of existing Character profiles (atomic per batch).",
      guidance:
        "Read first, then patch only the changed fields. baseRevision = entityVersion from the most recent read; stale revisions are rejected before approval — re-read and retry. null clears summary/initialState/authorNotes; [] clears aliases.",
    },
    precheck: async (call) => {
      const items = valuesOf(parseArgs(call)) as unknown as TargetedItem[];
      if (items.length === 0) return;
      const versions = await characterVersions(handle);
      for (const item of items) assertRevision(call.name, versions, item.id, item.baseRevision, "角色");
    },
    handler: {
      execute: async (call) => {
        const values = (valuesOf(parseArgs(call)) as unknown as Array<TargetedItem & { value: Partial<EntityInput> }>) ?? [];
        const results = await handle.mutateBatch(
          values.map((v) => ({ op: "character.update" as const, characterId: v.id as never, baseRevision: v.baseRevision, patch: v.value })),
        );
        return formatBatchItems(results);
      },
    },
  };
}

// ═══════════════ location ═══════════════

/**
 * 创建 location 工具（Read/Write/Edit），与 character 同构
 * @param handle novel 客户端
 * @returns 地点工具定义
 */
export function createLocationTools(handle: NovelHandle): ToolDef[] {
  return [locationRead(handle), locationWrite(handle), locationEdit(handle)];
}

function locationRead(handle: NovelHandle): ToolDef {
  return {
    name: "NovelLocationRead",
    version: "1.0.0",
    preview: locationReadPreview,
    description: [
      "读取地点档案（正式稿），只读。",
      "",
      "用法：",
      "- 省略 locationId：返回全部地点（含 id / name / entityVersion）。",
      "- 传入 locationId：返回单个地点完整档案（aliases / summary / initialState / authorNotes）。",
      "- 返回的 entityVersion 是 NovelLocationEdit / NovelDelete 所需 baseRevision 的来源；修改前先 Read 拿最新版本。",
    ].join("\n"),
    parameters: {
      type: "object",
      properties: {
        locationId: { type: "string", description: "地点 id（省略则列出全部地点）" },
      },
      additionalProperties: false,
    },
    promptDetail: {
      policy: "Reads committed (canonical) Location profiles; use it before any NovelLocationEdit or NovelDelete on a location.",
      guidance:
        "Omit locationId to list all. The returned entityVersion is the baseRevision later edits and deletes must carry; stale revisions are rejected before approval.",
    },
    handler: {
      execute: async (call) => {
        const args = parseArgs(call);
        const id = args.locationId as string | undefined;
        const result = id
          ? await handle.query({ op: "locations.get", locationId: id as never })
          : await handle.query({ op: "locations.list" });
        return JSON.stringify(result, null, 2);
      },
    },
  };
}

function locationWrite(handle: NovelHandle): ToolDef {
  return {
    name: "NovelLocationWrite",
    version: "1.0.0",
    preview: locationWritePreview,
    requireApproval: true,
    description: [
      "批量创建地点档案，直接写入正式稿（values 每项新建一个地点，整批原子）。",
      "",
      "用法：",
      "- name 必填；不做重名校验（重名会各自独立建档，查重先 NovelLocationRead）。",
      "- id 可选：客户端自选 id（重复报 duplicate_id）；缺省宿主生成并在结果回传。",
      "- aliases：别名/别称列表（≤32 项）；summary：一句话地点摘要。",
      "- initialState：登场时的状态设定；authorNotes：作者私有备注（不进正文）。",
      "- 只新建、不更新已有地点；修改已有地点用 NovelLocationEdit。",
    ].join("\n"),
    parameters: {
      type: "object",
      properties: {
        values: {
          type: "array",
          description: "要创建的地点列表（1-64 项，每项一个地点）",
          minItems: 1,
          maxItems: 64,
          items: {
            type: "object",
            properties: {
              id: { type: "string", pattern: ID_PATTERN, description: "自选 id（可选；缺省宿主生成）" },
              name: { type: "string", minLength: 1, maxLength: 200, description: "地点名（必填）" },
              aliases: { type: "array", items: { type: "string", minLength: 1, maxLength: 200 }, maxItems: 32, description: "别名/别称列表（可选）" },
              summary: { type: "string", maxLength: 20000, description: "地点摘要（可选）" },
              initialState: { type: "string", maxLength: 20000, description: "登场时的初始状态（可选）" },
              authorNotes: { type: "string", maxLength: 50000, description: "作者备注（可选）" },
            },
            required: ["name"],
            additionalProperties: false,
          },
        },
      },
      required: ["values"],
      additionalProperties: false,
    },
    promptDetail: {
      policy: "Batch-creates Location profiles in the canonical store (atomic per batch).",
      guidance:
        "name is required and not uniqueness-checked — list first to avoid duplicates. id is optional (client-chosen, duplicate_id rejected). To change an existing profile use NovelLocationEdit, not Write.",
    },
    precheck: async (call) => {
      const values = valuesOf(parseArgs(call));
      const withId = values.filter((v) => str(v.id) !== undefined);
      if (withId.length === 0) return;
      const versions = await locationVersions(handle);
      for (const v of withId) assertIdFree(call.name, versions, str(v.id)!, "地点");
    },
    handler: {
      execute: async (call) => {
        const values = valuesOf(parseArgs(call)) as unknown as Array<EntityInput & { id?: string }>;
        const results = await handle.mutateBatch(
          values.map((v) => ({ op: "location.create" as const, id: v.id, input: { name: v.name, aliases: v.aliases, summary: v.summary, initialState: v.initialState, authorNotes: v.authorNotes } })),
        );
        return formatBatchItems(results);
      },
    },
  };
}

function locationEdit(handle: NovelHandle): ToolDef {
  return {
    name: "NovelLocationEdit",
    version: "1.0.0",
    preview: locationEditPreview,
    requireApproval: true,
    description: [
      "批量局部更新（PATCH）已有地点档案，整批原子。",
      "",
      "用法：",
      "- 每项 = { id, baseRevision, value }。",
      "- baseRevision：最近一次 NovelLocationRead 读到的该地点 entityVersion（审批前预检，过期直接拒绝并附当前版本）。",
      "- value 只传要改的字段，未提供的字段保留原值。",
      "- 清空语义：summary / initialState / authorNotes 传 null 清空；aliases 传 [] 清空。",
    ].join("\n"),
    parameters: {
      type: "object",
      properties: {
        values: {
          type: "array",
          description: "要更新的地点列表（1-64 项：目标 + 乐观锁版本 + 补丁）",
          minItems: 1,
          maxItems: 64,
          items: {
            type: "object",
            properties: {
              id: { type: "string", pattern: ID_PATTERN, description: "目标地点 id" },
              baseRevision: { type: "integer", description: "最近读到的该地点 entityVersion（乐观锁）" },
              value: {
                type: "object",
                description: "要修改的字段（未提供的保留原值）",
                properties: {
                  name: { type: "string", minLength: 1, maxLength: 200, description: "新地点名（覆盖）" },
                  aliases: { type: "array", items: { type: "string", minLength: 1, maxLength: 200 }, maxItems: 32, description: "全量替换别名列表（[] 即清空）" },
                  summary: { type: ["string", "null"], maxLength: 20000, description: "摘要（null 清空）" },
                  initialState: { type: ["string", "null"], maxLength: 20000, description: "初始状态（null 清空）" },
                  authorNotes: { type: ["string", "null"], maxLength: 50000, description: "作者备注（null 清空）" },
                },
                additionalProperties: false,
              },
            },
            required: ["id", "baseRevision", "value"],
            additionalProperties: false,
          },
        },
      },
      required: ["values"],
      additionalProperties: false,
    },
    promptDetail: {
      policy: "Batch field-level partial updates (PATCH) of existing Location profiles (atomic per batch).",
      guidance:
        "Read first, then patch only the changed fields. baseRevision = entityVersion from the most recent read; stale revisions are rejected before approval — re-read and retry. null clears summary/initialState/authorNotes; [] clears aliases.",
    },
    precheck: async (call) => {
      const items = valuesOf(parseArgs(call)) as unknown as TargetedItem[];
      if (items.length === 0) return;
      const versions = await locationVersions(handle);
      for (const item of items) assertRevision(call.name, versions, item.id, item.baseRevision, "地点");
    },
    handler: {
      execute: async (call) => {
        const values = (valuesOf(parseArgs(call)) as unknown as Array<TargetedItem & { value: Partial<EntityInput> }>) ?? [];
        const results = await handle.mutateBatch(
          values.map((v) => ({ op: "location.update" as const, locationId: v.id as never, baseRevision: v.baseRevision, patch: v.value })),
        );
        return formatBatchItems(results);
      },
    },
  };
}

// ═══════════════ paragraph ═══════════════

/**
 * 创建 paragraph 工具（Read/Write/Edit），段落归属 story unit
 * @param handle novel 客户端
 * @returns 段落工具定义
 */
export function createParagraphTools(handle: NovelHandle): ToolDef[] {
  return [paragraphRead(handle), paragraphWrite(handle), paragraphEdit(handle)];
}

function paragraphRead(handle: NovelHandle): ToolDef {
  return {
    name: "NovelParagraphRead",
    version: "1.0.0",
    preview: paragraphReadPreview,
    description: [
      "读取正文段落（正式稿），只读。",
      "",
      "用法：",
      "- 传 storyUnitId：返回该大纲单元的全部段落，按 orderKey 升序。",
      "- 省略全部参数：返回全部段落（按单元分组、组内按 orderKey）。",
      "- 传 paragraphId：返回单个段落（含 entityVersion / text）。",
      "- 返回的 id 与 entityVersion 是 NovelParagraphEdit / NovelDelete 的输入来源；续写前先读现有段落以保持衔接。",
    ].join("\n"),
    parameters: {
      type: "object",
      properties: {
        storyUnitId: { type: "string", description: "大纲单元 id（按 orderKey 列出其全部段落；省略则返回全部段落）" },
        paragraphId: { type: "string", description: "段落 id（读取单个段落）" },
      },
      additionalProperties: false,
    },
    promptDetail: {
      policy: "Reads committed Paragraph content in story-unit order.",
      guidance:
        "storyUnitId lists that unit's paragraphs in order; omit it to read all paragraphs grouped by unit; paragraphId reads one. ids + entityVersion feed NovelParagraphEdit / NovelDelete.",
    },
    handler: {
      execute: async (call) => {
        const args = parseArgs(call);
        const result = args.paragraphId
          ? await handle.query({ op: "paragraph.get", paragraphId: args.paragraphId as never })
          : await handle.query({ op: "paragraphs.list", storyUnitId: args.storyUnitId as never });
        return JSON.stringify(result, null, 2);
      },
    },
  };
}

function paragraphWrite(handle: NovelHandle): ToolDef {
  return {
    name: "NovelParagraphWrite",
    version: "1.0.0",
    requireApproval: true,
    preview: paragraphWritePreview,
    description: [
      "批量在大纲单元（story unit）下插入新段落（按 values 顺序追加，整批原子）。",
      "",
      "用法：",
      "- 每项 = { storyUnitId, text, id?, orderKey? }；storyUnitId 推荐传 scene（场景）级单元——正文落在大纲树末端，章关联该单元后按此发布。",
      "- text 为该段完整正文（一个自然段一项，不合并多段）。",
      "- id 可选：自选 id（重复报 duplicate_id）；缺省宿主生成并在结果回传。",
      "- orderKey 可选：段间排序键（4 位大写十六进制组，如 \"0001\"/\"0002\"）；缺省由系统生成并排到该单元末尾。",
      "- 段落不可变：已有段落不受影响；修改已有段落用 NovelParagraphEdit。",
    ].join("\n"),
    parameters: {
      type: "object",
      properties: {
        values: {
          type: "array",
          description: "要插入的段落列表（1-64 项，按序追加）",
          minItems: 1,
          maxItems: 64,
          items: {
            type: "object",
            properties: {
              id: { type: "string", pattern: ID_PATTERN, description: "自选 id（可选；缺省宿主生成）" },
              storyUnitId: { type: "string", pattern: ID_PATTERN, description: "所属大纲单元 id" },
              orderKey: { type: "string", pattern: ORDER_KEY_PATTERN, description: "段间排序键（可选，缺省排到该单元末尾）" },
              text: { type: "string", description: "段落正文" },
            },
            required: ["storyUnitId", "text"],
            additionalProperties: false,
          },
        },
      },
      required: ["values"],
      additionalProperties: false,
    },
    promptDetail: {
      policy: "Batch-inserts Paragraphs under story units (atomic per batch).",
      guidance:
        "Target scene-level story units (paragraphs live at the tree's leaves; chapters publish from them). One natural paragraph per item — do not merge multiple paragraphs into one text. orderKey (4-hex-digit groups) is optional and appends to the end when omitted.",
    },
    precheck: async (call) => {
      const values = valuesOf(parseArgs(call));
      if (values.length === 0) return;
      const [units, paras] = await Promise.all([
        values.some((v) => str(v.storyUnitId) !== undefined) ? storyUnitVersions(handle) : Promise.resolve(new Map<string, number>()),
        values.some((v) => str(v.id) !== undefined) ? paragraphVersions(handle) : Promise.resolve(new Map<string, number>()),
      ]);
      for (const v of values) {
        const unitId = str(v.storyUnitId);
        if (unitId !== undefined) assertExists(call.name, units, unitId, "大纲单元");
        const id = str(v.id);
        if (id !== undefined) assertIdFree(call.name, paras, id, "段落");
      }
    },
    handler: {
      execute: async (call) => {
        const values = valuesOf(parseArgs(call)) as Array<{ id?: string; storyUnitId: string; orderKey?: string; text: string }>;
        const results = await handle.mutateBatch(
          values.map((v) => ({
            op: "paragraph.insert" as const,
            id: v.id,
            storyUnitId: v.storyUnitId as never,
            orderKey: v.orderKey as OrderKey | undefined,
            text: v.text,
          })),
        );
        return formatBatchItems(results);
      },
    },
  };
}

function paragraphEdit(handle: NovelHandle): ToolDef {
  return {
    name: "NovelParagraphEdit",
    version: "1.0.0",
    preview: paragraphEditPreview,
    requireApproval: true,
    description: [
      "批量局部更新（PATCH）已有段落，整批原子。",
      "",
      "用法：",
      "- 每项 = { id, baseRevision, value }；value 支持 text / storyUnitId / orderKey，未提供的保留。",
      "- text 为替换后的完整段落文本（不是增量片段）；storyUnitId 变更即移动段落到另一单元；orderKey 重排序。",
      "- baseRevision：最近读到的该段 entityVersion（审批前预检，过期直接拒绝并附当前版本）。",
      "- 建议先 NovelParagraphRead 取最新文本与版本，改写后整体替换。",
    ].join("\n"),
    parameters: {
      type: "object",
      properties: {
        values: {
          type: "array",
          description: "要更新的段落列表（1-64 项：目标 + 乐观锁版本 + 补丁）",
          minItems: 1,
          maxItems: 64,
          items: {
            type: "object",
            properties: {
              id: { type: "string", pattern: ID_PATTERN, description: "目标段落 id" },
              baseRevision: { type: "integer", description: "最近读到的该段 entityVersion（乐观锁）" },
              value: {
                type: "object",
                description: "要修改的字段（未提供的保留原值）",
                properties: {
                  storyUnitId: { type: "string", pattern: ID_PATTERN, description: "移动到该大纲单元" },
                  orderKey: { type: "string", pattern: ORDER_KEY_PATTERN, description: "重排序" },
                  text: { type: "string", description: "替换后的完整段落文本" },
                },
                additionalProperties: false,
              },
            },
            required: ["id", "baseRevision", "value"],
            additionalProperties: false,
          },
        },
      },
      required: ["values"],
      additionalProperties: false,
    },
    promptDetail: {
      policy: "Batch field-level PATCH updates for Paragraphs (atomic per batch).",
      guidance:
        "text replaces the paragraph entirely — not a diff. storyUnitId moves the paragraph, orderKey reorders it. Read first; stale baseRevision is rejected before approval.",
    },
    precheck: async (call) => {
      const items = valuesOf(parseArgs(call)) as unknown as Array<TargetedItem & { value?: Record<string, unknown> }>;
      if (items.length === 0) return;
      const paras = await paragraphVersions(handle);
      const units = await storyUnitVersions(handle);
      for (const item of items) {
        assertRevision(call.name, paras, item.id, item.baseRevision, "段落");
        const target = str(item.value?.storyUnitId);
        if (target !== undefined) assertExists(call.name, units, target, "大纲单元");
      }
    },
    handler: {
      execute: async (call) => {
        const values = (valuesOf(parseArgs(call)) as unknown as Array<TargetedItem & { value: { text?: string; storyUnitId?: string; orderKey?: string } }>) ?? [];
        const results = await handle.mutateBatch(
          values.map((v) => ({
            op: "paragraph.update" as const,
            paragraphId: v.id as never,
            baseRevision: v.baseRevision,
            text: v.value.text,
            storyUnitId: v.value.storyUnitId as never | undefined,
            orderKey: v.value.orderKey as OrderKey | undefined,
          })),
        );
        return formatBatchItems(results);
      },
    },
  };
}

// ═══════════════ volume / chapter（publication 拆分六件套） ═══════════════

/**
 * 创建 volume 工具（Read/Write/Edit）
 * @param handle novel 客户端
 * @returns 卷工具定义
 */
export function createVolumeTools(handle: NovelHandle): ToolDef[] {
  return [volumeRead(handle), volumeWrite(handle), volumeEdit(handle)];
}

/**
 * 创建 chapter 工具（Read/Write/Edit）
 * @param handle novel 客户端
 * @returns 章工具定义
 */
export function createChapterTools(handle: NovelHandle): ToolDef[] {
  return [chapterRead(handle), chapterWrite(handle), chapterEdit(handle)];
}

function volumeRead(handle: NovelHandle): ToolDef {
  return {
    name: "NovelVolumeRead",
    version: "1.0.0",
    preview: volumeReadPreview,
    description: [
      "读取全部卷（按 orderKey 排序），只读、无参数。",
      "",
      "用法：",
      "- 只返回每卷的 id / title / orderKey（不含章）；查章用 NovelChapterRead。",
      "- 卷的 entityVersion 在 NovelVolumeEdit / NovelDelete 前需先从这里拿。",
    ].join("\n"),
    parameters: { type: "object", properties: {}, additionalProperties: false },
    promptDetail: {
      policy: "Reads all Volumes in order.",
      guidance: "Returns id/title/orderKey only — use NovelChapterRead to inspect chapters. entityVersion feeds NovelVolumeEdit / NovelDelete.",
    },
    handler: {
      execute: async () => {
        const snap = (await handle.query({ op: "publication.get" })) as {
          volumes: { id: string; title: string; orderKey: string }[];
        };
        return JSON.stringify(
          { volumes: snap.volumes.map((v) => ({ id: v.id, title: v.title, orderKey: v.orderKey })) },
          null,
          2,
        );
      },
    },
  };
}

function volumeWrite(handle: NovelHandle): ToolDef {
  return {
    name: "NovelVolumeWrite",
    version: "1.0.0",
    preview: volumeWritePreview,
    requireApproval: true,
    description: [
      "批量创建卷（整批原子）。发布结构根自动存在，无需创建。",
      "",
      "用法：",
      "- 每项 = { title, id?, orderKey? }；title 必填（1-500 字）。",
      "- id 可选：自选 id（重复报 duplicate_id）；缺省宿主生成并在结果回传。",
      "- orderKey 可选（卷间排序，4 位大写十六进制组）；缺省追加到末卷之后。",
    ].join("\n"),
    parameters: {
      type: "object",
      properties: {
        values: {
          type: "array",
          description: "要创建的卷列表（1-64 项）",
          minItems: 1,
          maxItems: 64,
          items: {
            type: "object",
            properties: {
              id: { type: "string", pattern: ID_PATTERN, description: "自选 id（可选；缺省宿主生成）" },
              title: { type: "string", minLength: 1, maxLength: 500, description: "卷标题（必填）" },
              orderKey: { type: "string", pattern: ORDER_KEY_PATTERN, description: "卷间排序键（可选，缺省排到末尾）" },
            },
            required: ["title"],
            additionalProperties: false,
          },
        },
      },
      required: ["values"],
      additionalProperties: false,
    },
    promptDetail: {
      policy: "Batch-creates Volumes in the publication structure (atomic per batch).",
      guidance: "title required; orderKey optional (4-hex-digit groups, appends after the last volume when omitted); id optional (duplicate_id rejected).",
    },
    precheck: async (call) => {
      const values = valuesOf(parseArgs(call));
      const withId = values.filter((v) => str(v.id) !== undefined);
      if (withId.length === 0) return;
      const { volumes } = await publicationVersions(handle);
      for (const v of withId) assertIdFree(call.name, volumes, str(v.id)!, "卷");
    },
    handler: {
      execute: async (call) => {
        const values = valuesOf(parseArgs(call)) as Array<{ id?: string; title: string; orderKey?: string }>;
        const results = await handle.mutateBatch(
          values.map((v) => ({ op: "publication.volume.create" as const, id: v.id, title: v.title, orderKey: v.orderKey as OrderKey | undefined })),
        );
        return formatBatchItems(results);
      },
    },
  };
}

function volumeEdit(handle: NovelHandle): ToolDef {
  return {
    name: "NovelVolumeEdit",
    version: "1.0.0",
    preview: volumeEditPreview,
    requireApproval: true,
    description: [
      "批量局部更新（PATCH）已有卷，整批原子。",
      "",
      "用法：",
      "- 每项 = { id, baseRevision, value }；value 支持 title / orderKey，未提供的保留。",
      "- baseRevision：最近一次 NovelVolumeRead / NovelChapterRead 读到的该卷 entityVersion（审批前预检）。",
    ].join("\n"),
    parameters: {
      type: "object",
      properties: {
        values: {
          type: "array",
          description: "要更新的卷列表（1-64 项：目标 + 乐观锁版本 + 补丁）",
          minItems: 1,
          maxItems: 64,
          items: {
            type: "object",
            properties: {
              id: { type: "string", pattern: ID_PATTERN, description: "目标卷 id" },
              baseRevision: { type: "integer", description: "最近读到的该卷 entityVersion（乐观锁）" },
              value: {
                type: "object",
                description: "要修改的字段（未提供的保留原值）",
                properties: {
                  title: { type: "string", minLength: 1, maxLength: 500, description: "标题（覆盖）" },
                  orderKey: { type: "string", pattern: ORDER_KEY_PATTERN, description: "排序键（覆盖）" },
                },
                additionalProperties: false,
              },
            },
            required: ["id", "baseRevision", "value"],
            additionalProperties: false,
          },
        },
      },
      required: ["values"],
      additionalProperties: false,
    },
    promptDetail: {
      policy: "Batch field-level PATCH updates for Volumes (atomic per batch).",
      guidance: "value supports title/orderKey; baseRevision = entityVersion from the latest read.",
    },
    precheck: async (call) => {
      const items = valuesOf(parseArgs(call)) as unknown as TargetedItem[];
      if (items.length === 0) return;
      const { volumes } = await publicationVersions(handle);
      for (const item of items) assertRevision(call.name, volumes, item.id, item.baseRevision, "卷");
    },
    handler: {
      execute: async (call) => {
        const values = (valuesOf(parseArgs(call)) as unknown as Array<TargetedItem & { value: { title?: string; orderKey?: string } }>) ?? [];
        const results = await handle.mutateBatch(
          values.map((v) => ({ op: "publication.volume.update" as const, volumeId: v.id as never, baseRevision: v.baseRevision, patch: v.value as never })),
        );
        return formatBatchItems(results);
      },
    },
  };
}

function chapterRead(handle: NovelHandle): ToolDef {
  return {
    name: "NovelChapterRead",
    version: "1.0.0",
    preview: chapterReadPreview,
    description: [
      "读取章（可按 chapterId / volumeId 过滤），只读。",
      "",
      "用法：",
      "- 省略参数：返回全部章。",
      "- 传 volumeId：只返回该卷的章；传 chapterId：只返回该章。",
      "- includeContent=true：附带每章按选择（paragraphIds 有序，可跨单元）取回的正文段落。",
      "- 章（chapter）的 volumeId 缺省表示未归卷；正文以 paragraphIds 有序选择为准（拆分/合并/重排经 NovelChapterEdit）。",
      "- 返回的 entityVersion 是 NovelChapterEdit / NovelDelete 的 baseRevision 来源。",
    ].join("\n"),
    parameters: {
      type: "object",
      properties: {
        chapterId: { type: "string", description: "章 id（只读该章）" },
        volumeId: { type: "string", description: "卷 id（只读该卷的章）" },
        includeContent: { type: "boolean", description: "true 时附带章的正文来源段落" },
      },
      additionalProperties: false,
    },
    promptDetail: {
      policy: "Reads Chapters, optionally filtered by chapterId or volumeId.",
      guidance:
        "Chapter.volumeId absent = unassigned; Chapter.storyUnitId links the story unit providing its text (prefer scene-level). includeContent=true also returns the unit's paragraphs. entityVersion feeds NovelChapterEdit / NovelDelete.",
    },
    handler: {
      execute: async (call) => {
        const args = parseArgs(call);
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
      },
    },
  };
}

function chapterWrite(handle: NovelHandle): ToolDef {
  return {
    name: "NovelChapterWrite",
    version: "1.0.0",
    preview: chapterWritePreview,
    requireApproval: true,
    description: [
      "批量创建章（整批原子）。一次调用只建章；卷用 NovelVolumeWrite。",
      "",
      "用法：",
      "- 每项 = { title, volumeId?, paragraphIds?, storyUnitId?, id?, orderKey? }；title 必填（1-500 字）。",
      "- volumeId 可选（缺省 = 未归卷）。",
      "- paragraphIds 可选：章内段落有序选择（缺省空选择）——章的正文以选择为准，可跨单元、可拆分/合并/重排（后续调整用 NovelChapterEdit 的 paragraphIds 全量替换）；引用段落须已存在。",
      "- id 可选：自选 id（重复报 duplicate_id）；缺省宿主生成并在结果回传。",
      "- orderKey 可选（同卷章排序，4 位大写十六进制组）；缺省追加到同卷末章之后。",
    ].join("\n"),
    parameters: {
      type: "object",
      properties: {
        values: {
          type: "array",
          description: "要创建的章列表（1-64 项）",
          minItems: 1,
          maxItems: 64,
          items: {
            type: "object",
            properties: {
              id: { type: "string", pattern: ID_PATTERN, description: "自选 id（可选；缺省宿主生成）" },
              volumeId: { type: "string", pattern: ID_PATTERN, description: "所属卷 id（可选，缺省 = 未归卷）" },
              title: { type: "string", minLength: 1, maxLength: 500, description: "章标题（必填）" },
              storyUnitId: { type: "string", pattern: ID_PATTERN, description: "来源提示：正文以 paragraphIds 选择为准" },
              paragraphIds: {
                type: "array",
                items: { type: "string", pattern: ID_PATTERN },
                maxItems: 4096,
                description: "章内段落有序选择（可选，缺省空选择；引用段落须已存在）",
              },
              orderKey: { type: "string", pattern: ORDER_KEY_PATTERN, description: "同卷排序键（可选，缺省排到末尾）" },
            },
            required: ["title"],
            additionalProperties: false,
          },
        },
      },
      required: ["values"],
      additionalProperties: false,
    },
    promptDetail: {
      policy: "Batch-creates Chapters (atomic per batch).",
      guidance:
        "title required; volumeId absent = unassigned; storyUnitId (prefer scene-level) links the story unit providing its text. orderKey optional, appends after the last chapter in the same volume.",
    },
    precheck: async (call) => {
      const values = valuesOf(parseArgs(call));
      if (values.length === 0) return;
      const [pub, units, hasSelection] = await Promise.all([
        publicationVersions(handle),
        storyUnitVersions(handle),
        Promise.resolve(values.some((v) => Array.isArray(v.paragraphIds))),
      ]);
      const paras = hasSelection ? await paragraphVersions(handle) : new Map<string, number>();
      for (const v of values) {
        const vol = str(v.volumeId);
        if (vol !== undefined) assertExists(call.name, pub.volumes, vol, "卷");
        const unit = str(v.storyUnitId);
        if (unit !== undefined) assertExists(call.name, units, unit, "大纲单元");
        const id = str(v.id);
        if (id !== undefined) assertIdFree(call.name, pub.chapters, id, "章");
        if (Array.isArray(v.paragraphIds)) {
          for (const pid of v.paragraphIds) assertExists(call.name, paras, String(pid), "段落");
        }
      }
    },
    handler: {
      execute: async (call) => {
        const values = valuesOf(parseArgs(call)) as Array<{ id?: string; volumeId?: string; title: string; storyUnitId?: string; orderKey?: string; paragraphIds?: string[] }>;
        const results = await handle.mutateBatch(
          values.map((v) => ({
            op: "publication.chapter.create" as const,
            id: v.id,
            volumeId: v.volumeId as never | undefined,
            title: v.title,
            storyUnitId: v.storyUnitId as never | undefined,
            orderKey: v.orderKey as OrderKey | undefined,
            paragraphIds: v.paragraphIds as never | undefined,
          })),
        );
        return formatBatchItems(results);
      },
    },
  };
}

function chapterEdit(handle: NovelHandle): ToolDef {
  return {
    name: "NovelChapterEdit",
    version: "1.0.0",
    preview: chapterEditPreview,
    requireApproval: true,
    description: [
      "批量局部更新（PATCH）已有章，整批原子。",
      "",
      "用法：",
      "- 每项 = { id, baseRevision, value }；value 支持 title / orderKey / volumeId（调整归卷）/ paragraphIds，未提供的保留。",
      "- paragraphIds 全量替换章的有序段落选择——拆分、合并、重排、跨单元、单元中途收章都靠它；null 清空选择；引用段落须已存在。",
      "- baseRevision：最近读到的该章 entityVersion（审批前预检，过期直接拒绝并附当前版本）。",
    ].join("\n"),
    parameters: {
      type: "object",
      properties: {
        values: {
          type: "array",
          description: "要更新的章列表（1-64 项：目标 + 乐观锁版本 + 补丁）",
          minItems: 1,
          maxItems: 64,
          items: {
            type: "object",
            properties: {
              id: { type: "string", pattern: ID_PATTERN, description: "目标章 id" },
              baseRevision: { type: "integer", description: "最近读到的该章 entityVersion（乐观锁）" },
              value: {
                type: "object",
                description: "要修改的字段（未提供的保留原值）",
                properties: {
                  title: { type: "string", minLength: 1, maxLength: 500, description: "标题（覆盖）" },
                  orderKey: { type: "string", pattern: ORDER_KEY_PATTERN, description: "排序键（覆盖）" },
                  volumeId: { type: "string", pattern: ID_PATTERN, description: "所属卷 id（调整归卷）" },
                  paragraphIds: {
                    type: ["array", "null"],
                    items: { type: "string", pattern: ID_PATTERN },
                    maxItems: 4096,
                    description: "全量替换有序段落选择（拆分/合并/重排/跨单元/中途收章）；null 清空选择",
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
      required: ["values"],
      additionalProperties: false,
    },
    promptDetail: {
      policy: "Batch field-level PATCH updates for Chapters (atomic per batch).",
      guidance: "value supports title/orderKey/volumeId (re-assigning the volume). Chapter content belongs to paragraph tools — this only touches publication structure.",
    },
    precheck: async (call) => {
      const items = valuesOf(parseArgs(call)) as unknown as Array<TargetedItem & { value?: Record<string, unknown> }>;
      if (items.length === 0) return;
      const { volumes, chapters } = await publicationVersions(handle);
      const needParas = items.some((item) => Array.isArray(item.value?.paragraphIds));
      const paras = needParas ? await paragraphVersions(handle) : new Map<string, number>();
      for (const item of items) {
        assertRevision(call.name, chapters, item.id, item.baseRevision, "章");
        const vol = str(item.value?.volumeId);
        if (vol !== undefined) assertExists(call.name, volumes, vol, "卷");
        if (Array.isArray(item.value?.paragraphIds)) {
          for (const pid of item.value.paragraphIds as unknown[]) {
            assertExists(call.name, paras, String(pid), "段落");
          }
        }
      }
    },
    handler: {
      execute: async (call) => {
        const values = (valuesOf(parseArgs(call)) as unknown as Array<TargetedItem & { value: { title?: string; orderKey?: string; volumeId?: string } }>) ?? [];
        const results = await handle.mutateBatch(
          values.map((v) => ({ op: "publication.chapter.update" as const, chapterId: v.id as never, baseRevision: v.baseRevision, patch: v.value as never })),
        );
        return formatBatchItems(results);
      },
    },
  };
}

// ═══════════════ delete ═══════════════

/**
 * 创建 delete 工具（按实体 kind 分发删除）
 * @param handle novel 客户端
 * @returns 删除工具定义
 */
export function createDeleteTool(handle: NovelHandle): ToolDef[] {
  return [
    {
      name: "NovelDelete",
      version: "1.0.0",
      preview: novelDeletePreview,
      requireApproval: true,
      description: [
        "批量删除小说实体（高风险，不可恢复；整批原子）。",
        "",
        "用法：",
        "- 顶层 cascade（缺省 false）+ values 每项 = { kind, id, baseRevision }。",
        "- kind ∈ story_unit / character / location / paragraph / volume / chapter。",
        "- baseRevision：该实体最近一次读到的 entityVersion（审批前预检，过期直接拒绝并附当前版本）。",
        "- 依赖检查（cascade=false 默认拒绝）：story unit 有子单元/leaf 计划/段落、卷有章、章有段落选择——均直接拒绝并列出依赖。",
        "- cascade=true 级联：story unit 删整个子树（单元 + leaf 计划 + 段落及其章选择）、卷删其章（含各自选择，段落保留）、章解绑段落选择（段落保留）；删除段落会同时从所有章选择移除。",
        "- 返回 items + deleted[]（实际删除的每个实体完整记录，级联展开、跨批去重）。",
        "- 调用前先读（对应 Read 工具）确认目标与版本，并向用户确认后再执行（谨慎行动）。",
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
        policy: "Deletes novel entities by kind; irreversible, atomic per batch; dependency-checked unless cascade:true.",
        guidance:
          "High-risk: read the target first (for identity and entityVersion) and confirm with the author before calling. Default rejects units with children/leaf/paragraphs, volumes with chapters, chapters with selections; cascade:true deletes subtrees and returns full deleted[] records.",
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
    },
  ];
}

// ═══════════════ outline ═══════════════

/**
 * 创建 outline 工具（Read/Write/Edit），故事单元树
 * @param handle novel 客户端
 * @returns 大纲工具定义
 */
export function createOutlineTools(handle: NovelHandle): ToolDef[] {
  return [outlineRead(handle), outlineWrite(handle), outlineEdit(handle)];
}

function outlineRead(handle: NovelHandle): ToolDef {
  return {
    name: "NovelOutlineRead",
    version: "1.0.0",
    preview: outlineReadPreview,
    description: [
      "读取大纲（story unit 层级树，正式稿），只读。",
      "",
      "故事单元（story unit）是大纲树的节点，身兼三职：",
      "- 规划节点：intent（要达成什么）/ synopsis（梗概），加上规划、实现双状态推进写作。",
      "- 正文容器：正文段落直接挂在单元上（推荐落在 scene 场景级，见 NovelParagraphWrite）。",
      "- 发布来源：发布结构的「章」可关联一个单元作为正文来源（见 NovelChapterWrite）。",
      "",
      "用法：",
      "- 省略 storyUnitId：返回 { outline, units }——每本书有唯一一个大纲（自动存在，无需创建）；units 为全部单元平铺，层级由 parentId、顺序由 orderKey 表达，顶层单元即 parentId 缺省的单元（直接挂在大纲根下）。",
      "- 传入 storyUnitId：返回单个单元（含 intent / synopsis / scope / planningStatus / realizationStatus）。",
      "- includePlans=true：附带各单元的 leaf 计划（场景级故事设计：人物/地点绑定、事件序列、节奏拍、实体状态变更）与叶完成度 rollup（progress：effectiveStatus / isBlocked / completedLeafCount / totalLeafCount）——设计后续场景或检查进度时开启。",
      "- 新建子单元前先读全树定位 parentId；返回的 entityVersion 用于 NovelOutlineEdit / NovelDelete。",
    ].join("\n"),
    parameters: {
      type: "object",
      properties: {
        storyUnitId: { type: "string", description: "单元 id（省略则返回全树）" },
        includePlans: { type: "boolean", description: "true 时附带 leaf 计划与叶完成度 rollup" },
      },
      additionalProperties: false,
    },
    promptDetail: {
      policy: "Reads the story outline (story unit tree).",
      guidance:
        "Omit storyUnitId for the whole tree — one outline per book already exists; top-level units are those without parentId. A story unit is both a planning node (intent/synopsis/statuses) and the container for paragraphs (prefer scene-level). includePlans=true also returns leaf plans (scene-level design) and progress rollups. entityVersion feeds NovelOutlineEdit / NovelDelete.",
    },
    handler: {
      execute: async (call) => {
        const args = parseArgs(call);
        const includePlans = args.includePlans === true;
        const r = args.storyUnitId
          ? await handle.query({ op: "outline.storyUnit.get", storyUnitId: args.storyUnitId as never, includePlans })
          : await handle.query({ op: "outline.get", includePlans });
        return JSON.stringify(r, null, 2);
      },
    },
  };
}

function outlineWrite(handle: NovelHandle): ToolDef {
  return {
    name: "NovelOutlineWrite",
    version: "1.0.0",
    preview: outlineWritePreview,
    requireApproval: true,
    description: [
      "批量创建故事单元（story unit；大纲每本书唯一且自动存在，本工具只建单元；整批原子）。",
      "",
      "层级建议：saga（全书）→ arc（卷级弧）→ sequence（序列）→ scene（场景）自上而下建树；可按体量省略中间层（短篇可直接顶层建 scene），不必严格逐层。正文段落推荐落在 scene 级单元，发布时「章」关联该 scene 单元（storyUnitId）作为正文来源。",
      "",
      "用法：",
      "- 每项 = { title, parentId?, scope?, intent?, synopsis?, id?, orderKey?, planningStatus?, realizationStatus?, blockState?, abandonment?, leaf? }；title 必填（1-500 字）。",
      "- parentId 可选（缺省 = 顶层；建子单元前先 NovelOutlineRead 定位）。",
      "- intent：这个单元要达成什么；synopsis：情节梗概。",
      "- leaf：场景级故事设计文档（人物/地点绑定、事件序列、节奏拍、实体状态变更）——推荐挂在 scene 级叶单元，树末端承载具体故事；引用的角色/地点 id 必须已存在。",
      "- blockState：阻塞状态（原因 + 依赖单元）；abandonment：废弃状态（原因 + 替换单元）。一般随 NovelOutlineEdit 维护，创建时可直接带。",
      "- id 可选：自选 id（重复报 duplicate_id）；缺省宿主生成并在结果回传。",
      "- orderKey 可选（兄弟间排序，4 位大写十六进制组）；缺省追加到末位兄弟之后。",
      "- 新单元初始 planningStatus=idea、realizationStatus=pending（可随创建指定），随推进用 NovelOutlineEdit 更新。",
    ].join("\n"),
    parameters: {
      type: "object",
      properties: {
        values: {
          type: "array",
          description: "要创建的大纲单元列表（1-64 项）",
          minItems: 1,
          maxItems: 64,
          items: {
            type: "object",
            properties: {
              id: { type: "string", pattern: ID_PATTERN, description: "自选 id（可选；缺省宿主生成）" },
              parentId: { type: "string", pattern: ID_PATTERN, description: "父单元 id（缺省 = 顶层，挂在大纲根下）" },
              orderKey: { type: "string", pattern: ORDER_KEY_PATTERN, description: "兄弟间排序键（缺省排到末位之后）" },
              title: { type: "string", minLength: 1, maxLength: 500, description: "单元标题" },
              intent: { type: "string", maxLength: 20000, description: "单元意图（要达成什么）" },
              synopsis: { type: "string", maxLength: 50000, description: "情节梗概" },
              scope: {
                type: "string",
                enum: ["saga", "arc", "sequence", "scene", "custom"],
                description: "层级作用域：saga=全书 / arc=卷级弧 / sequence=序列 / scene=场景 / custom=自定义",
              },
              planningStatus: {
                type: "string",
                enum: ["idea", "outlined", "ready"],
                description: "规划状态：idea=点子 / outlined=已成纲 / ready=可开写（缺省 idea）",
              },
              realizationStatus: {
                type: "string",
                enum: ["pending", "in-progress", "completed", "abandoned"],
                description: "实现状态（缺省 pending）",
              },
              blockState: blockStateSchema(false),
              abandonment: abandonmentSchema(false),
              leaf: {
                type: "object",
                description: "leaf 计划：场景级故事设计文档（推荐挂 scene 级叶单元；引用的角色/地点 id 须已存在）",
                properties: LEAF_PLAN_PROPERTIES,
                required: ["settingMode", "characters", "locations", "events", "rhythmBeats", "entityChanges"],
                additionalProperties: false,
              },
            },
            required: ["title"],
            additionalProperties: false,
          },
        },
      },
      required: ["values"],
      additionalProperties: false,
    },
    promptDetail: {
      policy: "Batch-creates story units in the outline tree (atomic per batch).",
      guidance:
        "title required; parentId absent = top level (the one outline per book already exists). Build saga→arc→sequence→scene top-down, skipping middle tiers for short works; paragraphs live on scene-level units and chapters link them via storyUnitId. leaf attaches the scene-level design doc (character/location bindings, events, rhythm beats, entity changes) — referenced ids must exist. New units default to planningStatus=idea / realizationStatus=pending.",
    },
    precheck: async (call) => {
      const values = valuesOf(parseArgs(call));
      if (values.length === 0) return;
      const units = await storyUnitVersions(handle);
      for (const v of values) {
        const parent = str(v.parentId);
        if (parent !== undefined) assertExists(call.name, units, parent, "父大纲单元");
        const id = str(v.id);
        if (id !== undefined) assertIdFree(call.name, units, id, "大纲单元");
      }
      await assertReferencesExist(handle, call.name, collectReferences(values), units);
    },
    handler: {
      execute: async (call) => {
        const values = valuesOf(parseArgs(call)) as Array<{
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
        }>;
        const results = await handle.mutateBatch(
          values.map((v) => ({
            op: "outline.storyUnit.create" as const,
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
          })),
        );
        return formatBatchItems(results);
      },
    },
  };
}

function outlineEdit(handle: NovelHandle): ToolDef {
  return {
    name: "NovelOutlineEdit",
    version: "1.0.0",
    preview: outlineEditPreview,
    requireApproval: true,
    description: [
      "批量局部更新（PATCH）已有大纲单元，整批原子。",
      "",
      "用法：",
      "- 每项 = { id, baseRevision, value }（baseRevision = 最近读到的 entityVersion，审批前预检，过期直接拒绝并附当前版本）。",
      "- value 支持：title / intent / synopsis / scope / planningStatus / realizationStatus / parentId / orderKey / blockState / abandonment / leaf，未提供的保留。",
      "- 移动即编辑：parentId 换父节点（null = 移到顶层）、orderKey 重排，同在本工具表达。",
      "- blockState（null 清除）：阻塞状态（六类原因 + 依赖单元列表）；abandonment（null 清除）：废弃状态（六类原因 + 替换单元）。读路径的 progress.isBlocked 即由 blockState 派生。",
      "- leaf（null 清整个计划）：字段级替换——只传要改的集合（characters/locations/events/rhythmBeats/entityChanges），集合传 null 清空；引用的角色/地点/单元 id 必须已存在。",
      "- planningStatus（规划状态）：idea（点子）→ outlined（已成纲）→ ready（可开写）。",
      "- realizationStatus（实现状态）：pending（未动笔）/ in-progress（写作中）/ completed（已完成）/ abandoned（已废弃）。",
    ].join("\n"),
    parameters: {
      type: "object",
      properties: {
        values: {
          type: "array",
          description: "要更新的单元列表（1-64 项：目标 + 乐观锁版本 + 补丁）",
          minItems: 1,
          maxItems: 64,
          items: {
            type: "object",
            properties: {
              id: { type: "string", pattern: ID_PATTERN, description: "目标单元 id" },
              baseRevision: { type: "integer", description: "最近读到的该单元 entityVersion（乐观锁）" },
              value: {
                type: "object",
                description: "要修改的字段（未提供的保留原值）",
                properties: {
                  title: { type: "string", minLength: 1, maxLength: 500, description: "标题（覆盖）" },
                  intent: { type: "string", maxLength: 20000, description: "单元意图（覆盖）" },
                  synopsis: { type: "string", maxLength: 50000, description: "情节梗概（覆盖）" },
                  scope: {
                    type: "string",
                    enum: ["saga", "arc", "sequence", "scene", "custom"],
                    description: "层级作用域",
                  },
                  planningStatus: {
                    type: "string",
                    enum: ["idea", "outlined", "ready"],
                    description: "规划状态：idea=点子 / outlined=已成纲 / ready=可开写",
                  },
                  realizationStatus: {
                    type: "string",
                    enum: ["pending", "in-progress", "completed", "abandoned"],
                    description: "实现状态：pending=未动笔 / in-progress=写作中 / completed=已完成 / abandoned=已废弃",
                  },
                  parentId: { type: ["string", "null"], pattern: ID_PATTERN, description: "换父节点（null = 移到顶层）" },
                  orderKey: { type: "string", pattern: ORDER_KEY_PATTERN, description: "兄弟间重排序" },
                  blockState: blockStateSchema(true),
                  abandonment: abandonmentSchema(true),
                  leaf: {
                    type: ["object", "null"],
                    description: "leaf 计划补丁（null 清整个计划；字段级替换，集合字段传 null 清空）",
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
      required: ["values"],
      additionalProperties: false,
    },
    promptDetail: {
      policy: "Batch field-level PATCH updates for story units (atomic per batch): title/intent/synopsis/scope/statuses/parentId/orderKey/blockState/abandonment/leaf.",
      guidance:
        "id + baseRevision required (entityVersion from the latest NovelOutlineRead; stale = rejected before approval). Moving a unit is an Edit of parentId (null = root) and/or orderKey. blockState/abandonment null-clear; leaf patch replaces fields (null clears the whole plan or a collection). Referenced character/location/unit ids must exist.",
    },
    precheck: async (call) => {
      const items = valuesOf(parseArgs(call)) as unknown as Array<TargetedItem & { value?: Record<string, unknown> }>;
      if (items.length === 0) return;
      const units = await storyUnitVersions(handle);
      for (const item of items) {
        assertRevision(call.name, units, item.id, item.baseRevision, "大纲单元");
        const parent = str(item.value?.parentId);
        if (parent !== undefined) assertExists(call.name, units, parent, "父大纲单元");
      }
      await assertReferencesExist(handle, call.name, collectReferences(items.map((i) => i.value)), units);
    },
    handler: {
      execute: async (call) => {
        const values = (valuesOf(parseArgs(call)) as unknown as Array<TargetedItem & { value: Record<string, unknown> }>) ?? [];
        const results = await handle.mutateBatch(
          values.map((v) => ({
            op: "outline.storyUnit.update" as const,
            storyUnitId: v.id as never,
            baseRevision: v.baseRevision,
            patch: v.value as never,
          })),
        );
        return formatBatchItems(results);
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
