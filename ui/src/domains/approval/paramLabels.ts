/**
 * 审批参数中文标签表（key → 中文、枚举值 → 中文、工具名 → 中文）。
 * 未知 key / 枚举值 / 工具名一律回退原文。
 *
 * Chinese label tables for approval parameters: key labels, enum value
 * labels, and tool-name labels. Unknown keys / enum values / tool names
 * always fall back to the raw text.
 *
 * 注：blockState.reasonCode 与 abandonment.reasonCode 值域互不重叠（仅
 * "other" 共用），故合并为同一个 reasonCode 表，无需上下文消歧。
 */
export const PARAM_KEY_LABEL: Readonly<Record<string, string>> = {
  baseRevision: "基础修订版本",
  values: "变更项",
  value: "变更值",
  id: "ID",
  kind: "类型",
  orderKey: "顺序",
  description: "描述",
  note: "备注",
  name: "名称",
  aliases: "别名",
  summary: "简介",
  initialState: "初始状态",
  authorNotes: "作者注记",
  storyUnitId: "所属故事单元",
  text: "正文内容",
  title: "标题",
  volumeId: "所属卷",
  paragraphIds: "正文块 ID",
  intent: "意图",
  synopsis: "大纲提要",
  scope: "范围",
  planningStatus: "规划状态",
  realizationStatus: "实现状态",
  parentId: "上级单元",
  blockState: "阻塞状态",
  abandonment: "废弃信息",
  leaf: "叶子计划",
  reasonCode: "阻塞原因",
  dependencyIds: "依赖单元",
  blockedAt: "阻塞时间",
  replacementStoryUnitId: "替代单元",
  abandonedAt: "废弃时间",
  settingMode: "场景模式",
  time: "时间设定",
  characters: "角色",
  locations: "地点",
  events: "事件",
  rhythmBeats: "节奏节拍",
  entityChanges: "实体变化",
  characterId: "角色",
  locationId: "地点",
  involvement: "参与度",
  presence: "出场",
  roles: "作用",
  affected: "受影响",
  rhythm: "节奏",
  intensity: "强度",
  readerEmotion: "读者情绪",
  pointOfViewEmotion: "视角情绪",
  relatedEventIds: "关联事件",
  entityType: "实体类型",
  entityId: "实体",
  relatedEntityId: "关联实体",
  category: "类别",
  sourceEventIds: "来源事件",
  timelineOrderKey: "时间线顺序",
  cascade: "级联删除",
  purpose: "目的",
  // files 工具参数
  file_path: "文件路径",
  content: "文件内容",
  old_string: "查找内容",
  new_string: "替换内容",
  replace_all: "全部替换",
  pattern: "匹配模式",
  offset: "偏移量",
  limit: "数量限制",
};

export const PARAM_VALUE_LABEL: Readonly<
  Record<string, Readonly<Record<string, string>>>
> = {
  planningStatus: { idea: "点子", outlined: "已列大纲", ready: "就绪" },
  realizationStatus: {
    pending: "未开始",
    "in-progress": "进行中",
    completed: "已完成",
    abandoned: "已废弃",
  },
  scope: { saga: "系列", arc: "篇章", sequence: "段落", scene: "场景", custom: "自定义" },
  settingMode: { located: "定点场景", "location-independent": "非定点场景" },
  reasonCode: {
    dependency: "依赖阻塞",
    "decision-required": "需决策",
    "continuity-conflict": "连续性冲突",
    "missing-material": "缺少素材",
    "outline-incomplete": "大纲不完整",
    "story-direction-changed": "剧情方向变更",
    replaced: "被替代",
    merged: "已合并",
    duplicate: "重复",
    "scope-reduced": "范围缩减",
    other: "其他",
  },
  rhythm: {
    setup: "铺垫",
    rise: "上升",
    hold: "保持",
    turn: "转折",
    climax: "高潮",
    fall: "下落",
    release: "释放",
    aftermath: "余波",
  },
  presence: { present: "在场", offstage: "幕后", mentioned: "提及" },
  roles: { "point-of-view": "视角", participant: "参与者", observer: "旁观者", affected: "受影响" },
  locationRole: { primary: "主要", secondary: "次要", mentioned: "提及" },
  entityType: { character: "角色", location: "地点" },
  category: {
    identity: "身份",
    condition: "状态",
    location: "地点",
    relationship: "关系",
    knowledge: "认知",
    goal: "目标",
    ownership: "归属",
    environment: "环境",
    custom: "自定义",
  },
};

export const TOOL_NAME_LABEL: Readonly<Record<string, string>> = {
  Read: "读取文件",
  Glob: "搜索文件",
  Write: "写入文件",
  Edit: "编辑文件",
  NovelOutlineWrite: "大纲写入",
  NovelOutlineEdit: "大纲编辑",
  NovelCharacterWrite: "角色写入",
  NovelCharacterEdit: "角色编辑",
  NovelLocationWrite: "地点写入",
  NovelLocationEdit: "地点编辑",
  NovelParagraphWrite: "正文写入",
  NovelParagraphEdit: "正文编辑",
  NovelVolumeWrite: "卷写入",
  NovelVolumeEdit: "卷编辑",
  NovelChapterWrite: "章写入",
  NovelChapterEdit: "章编辑",
  NovelDelete: "删除",
  EnterComposeMode: "进入创作模式",
  ExitComposeMode: "退出创作模式",
};

/**
 * 参数字段渲染优先级（稳定排序）：name/title 开头、aliases 随后、authorNotes 收尾，
 * 其余字段同 rank 保持原插入顺序。
 *
 * Field render rank (stable sort): name/title first, aliases next, authorNotes
 * last; other fields keep their original insertion order at the default rank.
 */
export const PARAM_FIELD_RANK: Readonly<Record<string, number>> = {
  name: 0,
  title: 0,
  aliases: 1,
  authorNotes: 100,
};

export function paramFieldRank(field: string): number {
  return PARAM_FIELD_RANK[field] ?? 50;
}

/** 审批详情不展示的字段（内部标识，对审批决策无信息量）。Hidden param fields. */
const PARAM_HIDDEN_FIELDS: ReadonlySet<string> = new Set([
  "baseRevision",
  "id",
  // leaf 内部事件引用（relatedEventIds/sourceEventIds）：事件无独立名称，
  // 平铺只会露出 e1/e2 内部 id；leaf 走 LeafPlanCard 专用渲染。
  "relatedEventIds",
  "sourceEventIds",
]);

/**
 * id 引用字段（值指向其他实体，如 storyUnitId → 大纲单元）：渲染时经
 * id→名称映射替换为名称（demo 样例均显示名称）；paragraphIds 不在此列，
 * 按段落数摘要展示。ID-reference fields resolved to entity names.
 */
export const ID_REFERENCE_FIELDS: ReadonlySet<string> = new Set([
  "storyUnitId",
  "volumeId",
  "parentId",
  "characterId",
  "locationId",
  "entityId",
  "relatedEntityId",
  "replacementStoryUnitId",
  "dependencyIds",
]);

/** 段落 id 列表字段：显示为「正文 · N 段」摘要（段落 id 对作者无意义）。 */
export const PARAGRAPH_IDS_FIELD = "paragraphIds";

export function isIdReferenceField(field: string): boolean {
  return ID_REFERENCE_FIELDS.has(field);
}

export function isParamFieldHidden(field: string): boolean {
  return PARAM_HIDDEN_FIELDS.has(field);
}

/** 工具操作类型中文标签（写入/编辑/删除）。Operation type labels. */
export const OPERATION_LABEL: Readonly<Record<string, string>> = {
  add: "写入",
  edit: "编辑",
  delete: "删除",
};

export function operationLabel(op: string): string | undefined {
  return OPERATION_LABEL[op];
}

/** 变更类型 diff 符号（+ / ~ / −）。Operation diff glyphs. */
export const OPERATION_GLYPH: Readonly<Record<string, string>> = {
  add: "+",
  edit: "~",
  delete: "−",
};

export function operationGlyph(op: string): string | undefined {
  return OPERATION_GLYPH[op];
}

/** 从操作摘要或工具名推断变更类型；无法推断返回 undefined。 */
export function inferOperation(
  toolName: string,
  operations?: readonly { readonly op: string }[],
): "add" | "edit" | "delete" | undefined {
  const first = operations?.[0]?.op;
  if (first === "add" || first === "edit" || first === "delete") return first;
  if (/Write/.test(toolName)) return "add";
  if (/Edit/.test(toolName)) return "edit";
  if (/Delete/.test(toolName)) return "delete";
  return undefined;
}

export function paramKeyLabel(key: string): string | undefined {
  return PARAM_KEY_LABEL[key];
}

export function paramValueLabel(field: string, value: string): string | undefined {
  return PARAM_VALUE_LABEL[field]?.[value];
}

export function toolNameLabel(name: string): string {
  return TOOL_NAME_LABEL[name] ?? name;
}
