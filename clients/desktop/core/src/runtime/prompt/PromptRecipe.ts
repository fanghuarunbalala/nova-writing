/**
 * 有序不可变 Prompt 计划（AgentDefinition 持有）：段引用 + 内联文本两类条目。
 * Ordered immutable Prompt plan owned by an Agent Definition:
 * section references and inline text items.
 */

/** 段引用条目快照（持久化边界） */
export interface PromptSectionItemSnapshot {
  readonly kind: "section";
  readonly sectionId: string;
  readonly version?: string;
}

/** 内联条目快照（持久化边界） */
export interface InlinePromptItemSnapshot {
  readonly kind: "inline";
  readonly content: string;
}

export type PromptPlanItemSnapshot =
  | PromptSectionItemSnapshot
  | InlinePromptItemSnapshot;

export type PromptPlanItemKind = "section" | "inline";

/** Prompt 计划条目基类 */
export abstract class PromptPlanItem {
  abstract readonly kind: PromptPlanItemKind;
  /** 持久化边界快照 */
  abstract toSnapshot(): PromptPlanItemSnapshot;
}

/**
 * 段引用条目：sectionId 指向注册表；可选 version 精确锁定，
 * 缺省解析注册表最新版。
 */
export class PromptSectionItem extends PromptPlanItem {
  readonly kind = "section" as const;
  readonly sectionId: string;
  readonly requestedVersion?: string;

  /**
   * 构造段引用条目
   * @param sectionId 段 id（小写字母开头，点/下划线/连字符分段）
   * @param requestedVersion 精确版本（semver）；缺省最新版
   */
  constructor(sectionId: string, requestedVersion?: string) {
    super();
    this.sectionId = captureSectionId(sectionId);
    this.requestedVersion =
      requestedVersion === undefined ? undefined : captureVersion(requestedVersion);
    Object.freeze(this);
  }

  toSnapshot(): PromptSectionItemSnapshot {
    return Object.freeze({
      kind: this.kind,
      sectionId: this.sectionId,
      ...(this.requestedVersion === undefined ? {} : { version: this.requestedVersion }),
    });
  }
}

/** 内联文本条目：≤1024 字符的固定文本（不依赖注册表） */
export class InlinePromptItem extends PromptPlanItem {
  readonly kind = "inline" as const;
  readonly content: string;

  /**
   * 构造内联条目
   * @param content 固定文本（trim 后非空且 ≤1024 字符）
   */
  constructor(content: string) {
    super();
    if (
      typeof content !== "string" ||
      content.trim().length === 0 ||
      content.length > 1_024
    ) {
      throw new TypeError("Inline Prompt content is invalid");
    }
    this.content = content;
    Object.freeze(this);
  }

  toSnapshot(): InlinePromptItemSnapshot {
    return Object.freeze({ kind: this.kind, content: this.content });
  }
}

/** Prompt 计划快照（持久化边界） */
export interface PromptRecipeSnapshot {
  readonly items: readonly PromptPlanItemSnapshot[];
}

/** Prompt 计划条目数上限 */
const PROMPT_RECIPE_MAX_ITEMS = 64;

/**
 * 有序不可变 Prompt 计划：1..64 条目、段引用 id 唯一、冻结。
 * Ordered immutable prompt plan: 1..64 items, unique section ids, frozen.
 */
export class PromptRecipe {
  readonly items: readonly PromptPlanItem[];

  /**
   * 构造 Prompt 计划
   * @param items 有序条目（段引用 + 内联）
   */
  constructor(items: readonly PromptPlanItem[]) {
    if (!Array.isArray(items) || items.length === 0 || items.length > PROMPT_RECIPE_MAX_ITEMS) {
      throw new TypeError("Prompt Recipe items are invalid");
    }
    const sectionIds = new Set<string>();
    this.items = Object.freeze(
      [...items].map((item) => {
        if (!(item instanceof PromptPlanItem)) {
          throw new TypeError("Prompt Recipe item is invalid");
        }
        if (item instanceof PromptSectionItem) {
          if (sectionIds.has(item.sectionId)) {
            throw new TypeError("Prompt Recipe Section IDs must be unique");
          }
          sectionIds.add(item.sectionId);
        }
        return item;
      }),
    );
    Object.freeze(this);
  }

  toSnapshot(): PromptRecipeSnapshot {
    return Object.freeze({
      items: Object.freeze(this.items.map((item) => item.toSnapshot())),
    });
  }
}

/**
 * 捕获段 id（小写字母开头，点/下划线/连字符分段）
 * @param value 待校验值
 * @returns 校验通过的段 id
 */
export function captureSectionId(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(value)
  ) {
    throw new TypeError("Prompt Section ID is invalid");
  }
  return value;
}

/**
 * 捕获版本号（semver：x.y.z，0 或非 0 开头）
 * @param value 待校验值
 * @returns 校验通过的版本号
 */
export function captureVersion(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)
  ) {
    throw new TypeError("Prompt Section version is invalid");
  }
  return value;
}

/**
 * 捕获通用标识（字母数字开头，允许 . _ : -，≤256 字符）
 * @param value 待校验值
 * @param label 标识语义（报错文案用）
 * @returns 校验通过的标识
 */
export function captureIdentity(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value)
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}
