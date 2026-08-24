/**
 * outlineStatus
 *
 * 大纲状态语义表（对齐 core StoryUnit 契约与 app-redesign demo）：
 * 规划/实现/层级作用域的中文标签 + chip 色档；blocked 为派生态
 * （realizationStatus=pending 且有 blockState）。
 */
import type {
  LeafEntityChangeCategory,
  LeafPresence,
  LeafCharacterRole,
  LeafLocationRole,
  LeafRhythm,
  StoryUnit,
  StoryUnitAbandonReason,
  StoryUnitBlockReason,
  StoryUnitPlanningStatus,
  StoryUnitScope,
} from "@novel/core";
import type { StatusChipVariant } from "../../../shared/primitives/StatusChip.js";

/** 实现轴展示态（core 四态 + 派生 blocked） */
export type RealizationView = "pending" | "in-progress" | "completed" | "blocked" | "abandoned";

export const REAL_STATUS: Readonly<
  Record<RealizationView, { readonly label: string; readonly variant: StatusChipVariant }>
> = {
  pending: { label: "未动笔", variant: "neutral" },
  "in-progress": { label: "写作中", variant: "warn" },
  completed: { label: "已完成", variant: "success" },
  blocked: { label: "受阻", variant: "danger" },
  abandoned: { label: "废弃", variant: "faint" },
};

export const PLAN_STATUS: Readonly<
  Record<StoryUnitPlanningStatus, { readonly label: string; readonly variant: StatusChipVariant }>
> = {
  idea: { label: "点子", variant: "neutral" },
  outlined: { label: "已成纲", variant: "info" },
  ready: { label: "可开写", variant: "accent" },
};

export const SCOPE_TYPE: Readonly<
  Record<StoryUnitScope, { readonly label: string; readonly variant: StatusChipVariant }>
> = {
  saga: { label: "全书", variant: "accent" },
  arc: { label: "幕", variant: "accent" },
  sequence: { label: "幕", variant: "info" },
  scene: { label: "场景", variant: "neutral" },
  custom: { label: "自定义", variant: "faint" },
};

/** scope 缺省归 custom（core scope 可选） */
export function scopeView(scope: StoryUnitScope | undefined) {
  return SCOPE_TYPE[scope ?? "custom"];
}

/**
 * synopsis 覆盖区间脱敏：解析产物的「（覆盖 <bookId>-pXXXXXX–pYYYYYY）」
 * （GUI 进度信号，原文保留在数据层）显示为「（覆盖正文 pXXXXXX–pYYYYYY）」。
 * 入参兼容 null（历史数据/InMemory 直写可能带 null——.replace 对 null 崩）。
 */
export function formatSynopsisDisplay(synopsis: string | null | undefined): string {
  if (synopsis == null) return "";
  return synopsis
    .replace(
      // 书库解析标记：「（覆盖 <bookId>-pXXXXXX–pYYYYYY）」
      /（覆盖\s*[^\s（）]+-(p[0-9A-Za-z]+)\s*[–—-]\s*[^\s（）]+-(p[0-9A-Za-z]+)\s*）/g,
      "（覆盖正文 $1–$2）",
    )
    .replace(
      // 项目导入解构标记：「（覆盖 imp-bXXXXXX–imp-bYYYYYY）」
      /（覆盖\s*imp-b([0-9]+)\s*[–—-]\s*imp-b([0-9]+)\s*）/g,
      "（覆盖正文 批次 $1–$2）",
    );
}

/** 派生实现态：pending + blockState → blocked（与 core rollup 口径一致） */
export function realizationView(unit: {
  realizationStatus: StoryUnit["realizationStatus"];
  blockState?: { dependencyIds: readonly string[] };
}): RealizationView {
  if (unit.realizationStatus === "pending" && unit.blockState !== undefined) {
    return "blocked";
  }
  return unit.realizationStatus;
}

export const BLOCK_REASON_LABEL: Readonly<Record<StoryUnitBlockReason, string>> = {
  dependency: "依赖未定",
  "decision-required": "待决策",
  "continuity-conflict": "连贯性冲突",
  "missing-material": "素材缺失",
  "outline-incomplete": "大纲未完成",
  other: "其他",
};

export const ABANDON_REASON_LABEL: Readonly<Record<StoryUnitAbandonReason, string>> = {
  "story-direction-changed": "故事方向调整",
  replaced: "被替代",
  merged: "已并入",
  duplicate: "重复",
  "scope-reduced": "体量缩减",
  other: "其他",
};

export const LEAF_PRESENCE_LABEL: Readonly<Record<LeafPresence, string>> = {
  present: "在场",
  offstage: "离场",
  mentioned: "提及",
};

export const LEAF_ROLE_LABEL: Readonly<Record<LeafCharacterRole, string>> = {
  "point-of-view": "视角",
  participant: "参与",
  observer: "旁观",
  affected: "受影响",
};

export const LEAF_LOC_ROLE_LABEL: Readonly<Record<LeafLocationRole, string>> = {
  primary: "主要",
  secondary: "次要",
  mentioned: "提及",
};

export const LEAF_RHYTHM_LABEL: Readonly<Record<LeafRhythm, string>> = {
  setup: "铺垫",
  rise: "上升",
  hold: "保持",
  turn: "转折",
  climax: "高潮",
  fall: "回落",
  release: "释放",
  aftermath: "余波",
};

export const LEAF_CHANGE_LABEL: Readonly<Record<LeafEntityChangeCategory, string>> = {
  identity: "身份",
  condition: "状态",
  location: "位置",
  relationship: "关系",
  knowledge: "认知",
  goal: "目标",
  ownership: "所有",
  environment: "环境",
  custom: "自定义",
};
