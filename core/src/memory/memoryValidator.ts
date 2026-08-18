/**
 * memory 域动态编译校验器（PRD F5，v0.7 两域）。
 *
 * 三级触发的校验本体：files 工具写后拦截 / memory nudge 注入兜底都调用这里。
 * 校验失败不回滚文件——错误以列表返回，由调用方呈现在工具结果或注入提示中，
 * 构成 agent 修复环（预设文件的错误文案指向作者，agent 不修复）。
 */
import YAML from "yaml";
import {
  DATE_PATTERN,
  ENTRY_ID_PATTERN,
  ENTRY_LIMITS,
  MEMORY_DOMAINS,
  MEMORY_INDEX_FILE,
  MEMORY_RENDER_MAX,
  PRESET_ROOT,
  PROSE_TEXT_MAX,
  REFERENCES_ROOT,
  STORY_TEXT_MAX,
  emptyMemoryIndex,
  type MemoryCaseFile,
  type MemoryDomain,
  type MemoryIndex,
  type MemoryIndexEntry,
} from "./memorySchema.js";

/** 校验结果：errors 空即通过 */
export interface ValidationResult<T> {
  readonly errors: string[];
  readonly value?: T;
}

// ── 基础工具 ──

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function isDate(v: unknown): boolean {
  return typeof v === "string" && DATE_PATTERN.test(v);
}

/** YAML 解析（错误转校验错误而不是抛出） */
function parseYaml(text: string, label: string): ValidationResult<Record<string, unknown>> {
  try {
    const doc = YAML.parse(text);
    if (doc === null || doc === undefined) {
      return { errors: [`${label}: 文件为空`] };
    }
    if (!isPlainObject(doc)) {
      return { errors: [`${label}: 顶层必须是映射（key: value）结构`] };
    }
    return { errors: [], value: doc };
  } catch (err) {
    return { errors: [`${label}: YAML 解析失败——${(err as Error).message}`] };
  }
}

/** 构建期可变目录（组装完成后按 MemoryIndex 只读返回） */
type WritableIndex = {
  version: number;
  usedPresets?: readonly string[];
  prose?: readonly MemoryIndexEntry[];
  story?: readonly MemoryIndexEntry[];
};

// ── MEMORY.yaml（目录）校验 ──

/**
 * 解析并校验 MEMORY.yaml 目录文本。
 * 只做单文件结构校验；路径存在性/一致性在 validateMemoryTree（需要 fs）。
 */
export function parseAndValidateIndex(text: string): ValidationResult<MemoryIndex> {
  const label = MEMORY_INDEX_FILE;
  const parsed = parseYaml(text, label);
  if (parsed.value === undefined) {
    return { errors: parsed.errors };
  }
  const doc = parsed.value;
  const errors: string[] = [];

  if (typeof doc.version !== "number" || !Number.isInteger(doc.version) || doc.version < 1) {
    errors.push(`${label}: version 必须是 ≥1 的整数`);
  }

  const index: WritableIndex = {
    version: typeof doc.version === "number" && Number.isInteger(doc.version) && doc.version >= 1
      ? doc.version
      : 1,
    usedPresets: undefined,
    prose: undefined,
    story: undefined,
  };

  if (doc.usedPresets !== undefined) {
    if (
      !Array.isArray(doc.usedPresets) ||
      doc.usedPresets.length === 0 ||
      !doc.usedPresets.every((u) => nonEmptyString(u))
    ) {
      errors.push(`${label}: usedPresets 必须是非空字符串数组（引用键 <preset 相对路径>#<id>）`);
    } else {
      index.usedPresets = doc.usedPresets as string[];
    }
  }

  for (const domain of MEMORY_DOMAINS) {
    const list = doc[domain];
    if (list === undefined) {
      continue;
    }
    if (!Array.isArray(list) || list.length === 0) {
      errors.push(`${label}: ${domain} 必须是非空条目数组（无类目请删除该键）`);
      continue;
    }
    const entries: MemoryIndexEntry[] = [];
    const seenNames = new Set<string>();
    list.forEach((raw, i) => {
      const at = `${label}: ${domain}[${i}]`;
      if (!isPlainObject(raw)) {
        errors.push(`${at}: 必须是映射结构`);
        return;
      }
      if (!nonEmptyString(raw.name)) {
        errors.push(`${at}: name 不能为空`);
      }
      if (!nonEmptyString(raw.desc)) {
        errors.push(`${at}: desc 不能为空（一句话类目内容描述）`);
      }
      if (!nonEmptyString(raw.path)) {
        errors.push(`${at}: path 不能为空`);
      } else if (
        typeof raw.path === "string" &&
        !raw.path.startsWith(`${REFERENCES_ROOT}/${domain}/`)
      ) {
        errors.push(`${at}: path 必须位于 ${REFERENCES_ROOT}/${domain}/ 下`);
      }
      if (nonEmptyString(raw.name)) {
        if (seenNames.has(raw.name)) {
          errors.push(`${at}: name「${raw.name}」在 ${domain} 域内重复`);
        }
        seenNames.add(raw.name);
      }
      if (nonEmptyString(raw.name) && nonEmptyString(raw.desc) && nonEmptyString(raw.path)) {
        entries.push({ name: raw.name, desc: raw.desc, path: raw.path });
      }
    });
    if (entries.length > 0) {
      index[domain] = entries;
    }
  }

  if (errors.length > 0) {
    return { errors };
  }
  return { errors: [], value: index as MemoryIndex };
}

// ── 案例文件校验（动态库与 preset 同构；preset 豁免条数上限）──

/**
 * 解析并校验案例文件文本。
 * @param domain 期望域（由文件所在子目录决定）
 * @param preset true=preset 文件（story 条目无 used、source=preset、豁免条数上限）
 */
export function parseAndValidateCaseFile(
  text: string,
  opts: { domain: MemoryDomain; preset: boolean },
): ValidationResult<MemoryCaseFile> {
  const label = `${opts.preset ? PRESET_ROOT : REFERENCES_ROOT}/${opts.domain}`;
  const parsed = parseYaml(text, label);
  if (parsed.value === undefined) {
    return { errors: parsed.errors };
  }
  const doc = parsed.value;
  const errors: string[] = [];

  if (doc.kind !== opts.domain) {
    errors.push(`${label}: kind 必须是 ${opts.domain}`);
  }
  if (!nonEmptyString(doc.name)) {
    errors.push(`${label}: name 不能为空`);
  }
  if (!nonEmptyString(doc.desc)) {
    errors.push(`${label}: desc 不能为空`);
  }
  if (doc.updated !== undefined && !isDate(doc.updated)) {
    errors.push(`${label}: updated 必须是 YYYY-MM-DD`);
  }
  if (!Array.isArray(doc.entries)) {
    errors.push(`${label}: entries 必须是数组`);
    return { errors };
  }
  if (doc.entries.length === 0) {
    errors.push(`${label}: entries 不能为空（无案例请删除文件并同步目录）`);
  }

  const ids = new Set<string>();
  doc.entries.forEach((raw, i) => {
    if (!isPlainObject(raw)) {
      errors.push(`${label}: entries[${i}] 必须是映射结构`);
      return;
    }
    const at = `${label} 条目 ${raw.id ?? i}`;
    if (!nonEmptyString(raw.id) || !ENTRY_ID_PATTERN.test(String(raw.id))) {
      errors.push(`${at}: id 必须是三位序号（001 起，不复用已删 id）`);
    } else if (ids.has(raw.id)) {
      errors.push(`${at}: id 重复`);
    } else {
      ids.add(String(raw.id));
    }
    if (!isDate(raw.added)) {
      errors.push(`${at}: added 必须是 YYYY-MM-DD`);
    }
    validateSource(raw, at, opts, errors);
    if (opts.domain === "prose") {
      validateProseEntry(raw, at, errors);
    } else {
      validateStoryEntry(raw, at, opts, errors);
    }
  });

  if (!opts.preset && doc.entries.length > ENTRY_LIMITS[opts.domain]) {
    errors.push(
      `${label}: 条数 ${doc.entries.length} 超过上限 ${ENTRY_LIMITS[opts.domain]}（替换制：满则先问作者替换哪条）`,
    );
  }

  if (errors.length > 0) {
    return { errors };
  }
  return {
    errors: [],
    value: doc as unknown as MemoryCaseFile,
  };
}

function validateSource(
  raw: Record<string, unknown>,
  at: string,
  opts: { domain: MemoryDomain; preset: boolean },
  errors: string[],
): void {
  if (opts.preset) {
    if (raw.source !== "preset") {
      errors.push(`${at}: preset 文件 source 必须是 preset`);
    }
    return;
  }
  if (opts.domain === "story") {
    if (raw.source !== "author-request") {
      errors.push(`${at}: story 域 source 必须是 author-request（仅作者主动要求可入库）`);
    }
  } else if (raw.source !== "paste" && raw.source !== "approved-output") {
    errors.push(`${at}: source 必须是 paste 或 approved-output`);
  }
}

function validateProseEntry(raw: Record<string, unknown>, at: string, errors: string[]): void {
  if (typeof raw.text !== "string" || raw.text.trim().length === 0) {
    errors.push(`${at}: text 不能为空`);
    return;
  }
  if (raw.text.length > PROSE_TEXT_MAX) {
    errors.push(`${at}: text ${raw.text.length} 字超过上限 ${PROSE_TEXT_MAX}`);
  }
}

function validateStoryEntry(
  raw: Record<string, unknown>,
  at: string,
  opts: { preset: boolean },
  errors: string[],
): void {
  if (typeof raw.text !== "string" || raw.text.trim().length === 0) {
    errors.push(`${at}: text 不能为空`);
  } else if (raw.text.length > STORY_TEXT_MAX) {
    errors.push(`${at}: text ${raw.text.length} 字超过上限 ${STORY_TEXT_MAX}`);
  }
  if (opts.preset) {
    if (raw.used !== undefined) {
      errors.push(`${at}: preset 文件不得有 used 字段（采用追踪在 MEMORY.yaml 的 usedPresets）`);
    }
    return;
  }
  if (raw.used === undefined) {
    errors.push(`${at}: used 不能缺失（false 或采用日期 YYYY-MM-DD）`);
  } else if (raw.used !== false && !isDate(raw.used)) {
    errors.push(`${at}: used 必须是 false 或采用日期 YYYY-MM-DD`);
  }
}

// ── 文件树整体校验（交叉一致性；需要 fs，由调用方注入读取器便于测试） ──

/** 文件读取器（生产=node:fs/promises；测试注入内存实现） */
export interface MemoryFileReader {
  /** 读文本文件；不存在返回 undefined */
  read(relPath: string): Promise<string | undefined>;
  /** 列目录下全部文件（相对路径，/ 分隔）；目录不存在返回空数组 */
  list(relDir: string): Promise<string[]>;
}

/** 文件树整体状态（渲染与自愈的输入） */
export interface MemoryTree {
  /** MEMORY.yaml 是否存在 */
  readonly indexExists: boolean;
  readonly index: MemoryIndex;
  /** 目录/交叉一致性错误（单文件结构错误已含在各文件 errors） */
  readonly errors: string[];
  /** preset 目录下的类目（按文件 frontmatter 汇总） */
  readonly presetEntries: readonly MemoryIndexEntry[];
  /** preset 校验错误（文案指向作者） */
  readonly presetErrors: string[];
}

/**
 * 全树动态编译校验（PRD F5 校验清单的交叉项）：
 * MEMORY.yaml ↔ references/ ↔ preset/ 的路径存在性、kind/name/desc 一致性、
 * 孤儿文件、usedPresets 悬空引用、目录总字数。
 */
export async function validateMemoryTree(
  reader: MemoryFileReader,
): Promise<MemoryTree> {
  const errors: string[] = [];
  const presetErrors: string[] = [];

  const indexText = await reader.read(MEMORY_INDEX_FILE);
  const indexParsed =
    indexText === undefined
      ? { errors: [] as string[], value: emptyMemoryIndex() }
      : parseAndValidateIndex(indexText);
  errors.push(...indexParsed.errors);
  const index = indexParsed.value ?? emptyMemoryIndex();

  // 动态库交叉：目录条目 ↔ 文件
  const referencedPaths = new Set<string>();
  for (const domain of MEMORY_DOMAINS) {
    for (const entry of index[domain] ?? []) {
      const text = await reader.read(entry.path);
      if (text === undefined) {
        errors.push(`目录条目 ${domain}·${entry.name}: 文件不存在 ${entry.path}`);
        continue;
      }
      const file = parseAndValidateCaseFile(text, { domain, preset: false });
      errors.push(...file.errors.map((e) => `${entry.path}: ${e}`));
      if (file.value !== undefined) {
        if (file.value.name !== entry.name) {
          errors.push(`目录条目 ${domain}·${entry.name}: 文件 name「${file.value.name}」与目录不一致`);
        }
        if (file.value.desc !== entry.desc) {
          errors.push(`目录条目 ${domain}·${entry.name}: 文件 desc 与目录不一致`);
        }
      }
      referencedPaths.add(entry.path);
    }
  }
  // 孤儿文件（references/ 下有文件但目录无条目）
  for (const domain of MEMORY_DOMAINS) {
    const files = await reader.list(`${REFERENCES_ROOT}/${domain}`);
    for (const f of files) {
      if (!referencedPaths.has(f)) {
        errors.push(`孤儿文件 ${f}: MEMORY.yaml 目录中没有对应条目（新建类目须同步目录并 version+1）`);
      }
    }
  }

  // preset 扫描（不进目录；错误文案指向作者）
  const presetEntries: MemoryIndexEntry[] = [];
  for (const domain of MEMORY_DOMAINS) {
    const files = await reader.list(`${PRESET_ROOT}/${domain}`);
    for (const f of files) {
      const text = await reader.read(f);
      if (text === undefined) {
        continue;
      }
      const file = parseAndValidateCaseFile(text, { domain, preset: true });
      presetErrors.push(...file.errors.map((e) => `${f}: ${e}（预设格式有误,请作者手动修复;agent 不可修改预设）`));
      if (file.value !== undefined) {
        presetEntries.push({ name: file.value.name, desc: file.value.desc, path: f });
      }
    }
  }

  // usedPresets 悬空引用
  for (const ref of index.usedPresets ?? []) {
    const hashAt = ref.lastIndexOf("#");
    if (hashAt <= 0) {
      errors.push(`usedPresets: 引用键格式错误 ${ref}（应为 <preset 相对路径>#<id>）`);
      continue;
    }
    const filePath = `${PRESET_ROOT}/${ref.slice(0, hashAt)}`;
    const entryId = ref.slice(hashAt + 1);
    const text = await reader.read(filePath);
    if (text === undefined) {
      errors.push(`usedPresets: 预设文件不存在 ${ref}`);
      continue;
    }
    const file = parseAndValidateCaseFile(text, {
      domain: domainOfPresetPath(ref),
      preset: true,
    });
    const hasId =
      file.value !== undefined && (file.value.entries as ReadonlyArray<{ id: string }>).some(
        (e) => e.id === entryId,
      );
    if (!hasId) {
      errors.push(`usedPresets: 预设条目不存在 ${ref}`);
    }
  }

  // 目录总字数（注入渲染上限同源）
  if (indexText !== undefined && indexText.length > MEMORY_RENDER_MAX) {
    errors.push(`${MEMORY_INDEX_FILE}: ${indexText.length} 字超过上限 ${MEMORY_RENDER_MAX}（整理合并类目）`);
  }

  return {
    indexExists: indexText !== undefined,
    index,
    errors,
    presetEntries,
    presetErrors,
  };
}

/** preset 相对路径（story/复仇.yaml#002）→ 域 */
function domainOfPresetPath(ref: string): MemoryDomain {
  const first = ref.split("/")[0] ?? "";
  return (MEMORY_DOMAINS as readonly string[]).includes(first)
    ? (first as MemoryDomain)
    : "story";
}
