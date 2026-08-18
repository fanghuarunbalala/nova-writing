/**
 * compose 案例引导（novel-guide）类型（PRD compose-案例引导 v0.3）。
 * ComposeGuideSnapshot 定义在 prompt 层（PromptSection.ts，与
 * NovelGlobalConstraintsSnapshot 同位）避免 prompt↔agent 反向依赖，此处 re-export。
 */
export type { ComposeGuideSnapshot } from "../../prompt/PromptSection.js";

/** 意图分类标签（task_type 必出；character_type / situation 有信号才出，缺省不筛） */
export interface IntentTags {
  /** 任务类型（案例库枚举之一） */
  readonly taskType: string;
  /** 人物类型（可选；分类器弃权则缺省） */
  readonly characterType?: string;
  /** 叙事情景（可选；分类器弃权则缺省） */
  readonly situation?: string;
}

/** 案例条目（front-matter 派生；path 为 workspace 相对路径，Read 自读用） */
export interface GuideCaseEntry {
  /** 文件名（.novel/cases/ 内） */
  readonly file: string;
  /** workspace 相对路径（正斜杠） */
  readonly path: string;
  /** 任务类型标签（必填，缺失即整份跳过） */
  readonly taskType: string;
  /** 人物类型标签（可选） */
  readonly characterType?: string;
  /** 叙事情景标签（可选） */
  readonly situation?: string;
  /** 一句话适用场景（索引展示） */
  readonly summary: string;
  /** 排序键（缺省文件名序） */
  readonly order?: number;
}
