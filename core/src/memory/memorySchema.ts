/**
 * memory 域 schema 常量与类型（docs/PRD/memory-案例参考.md v0.7）。
 *
 * 两域动态库（对话闸门入库）+ preset 预设域（作者手动/代码维护，agent 只读）。
 * 「案例即偏好」：条目只含作者喜欢的正例；两域正交——prose 管「怎么写」
 * （仿质感），story 管「写什么」（素材可直接采用）。
 */

/** 动态库目录文件（项目根，与 NOVEL.md 并列） */
export const MEMORY_INDEX_FILE = "MEMORY.yaml";
/** 动态案例根目录（workspace 相对） */
export const REFERENCES_ROOT = ".novel/references";
/** 预设根目录（workspace 相对；Write/Edit 硬闸保护） */
export const PRESET_ROOT = ".novel/preset";

/** 两域 */
export const MEMORY_DOMAINS = ["prose", "story"] as const;
export type MemoryDomain = (typeof MEMORY_DOMAINS)[number];

/** 条数内置上限（不在文件中暴露；preset 不受限——作者自管） */
export const ENTRY_LIMITS: Readonly<Record<MemoryDomain, number>> = Object.freeze({
  prose: 5,
  story: 10,
});

/** 单条 text 限长 */
export const PROSE_TEXT_MAX = 300;
export const STORY_TEXT_MAX = 500;
/** MEMORY.yaml 注入渲染硬上限（超出截断 + 整理提示） */
export const MEMORY_RENDER_MAX = 6000;

/** 条目来源 */
export const SOURCES = ["paste", "approved-output", "author-request", "preset"] as const;
export type EntrySource = (typeof SOURCES)[number];

/** 日期格式（added/updated/used） */
export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** 条目 id 格式（文件内唯一三位序号） */
export const ENTRY_ID_PATTERN = /^\d{3}$/;

// ── MEMORY.yaml（目录）──

/** 目录条目：name + desc + path，仅此而已 */
export interface MemoryIndexEntry {
  readonly name: string;
  readonly desc: string;
  readonly path: string;
}

/** MEMORY.yaml 解析形态 */
export interface MemoryIndex {
  readonly version: number;
  readonly usedPresets?: readonly string[];
  readonly prose?: readonly MemoryIndexEntry[];
  readonly story?: readonly MemoryIndexEntry[];
}

/** 空目录（MEMORY.yaml 不存在时的合法初态） */
export function emptyMemoryIndex(): MemoryIndex {
  return { version: 1 };
}

// ── 案例文件（references 与 preset 同构）──

export interface ProseEntry {
  readonly id: string;
  readonly source: "paste" | "approved-output";
  readonly added: string;
  readonly text: string;
}

export interface StoryEntry {
  readonly id: string;
  readonly source: "author-request" | "preset";
  readonly added: string;
  /** 动态库：false 或采用日期；preset：无此字段 */
  readonly used?: boolean | string;
  readonly text: string;
}

export interface MemoryCaseFile {
  readonly kind: MemoryDomain;
  readonly name: string;
  readonly desc: string;
  readonly updated?: string;
  readonly entries: readonly ProseEntry[] | readonly StoryEntry[];
}
