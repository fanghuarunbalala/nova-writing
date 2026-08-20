/**
 * SkillRegistry：Agent Skills（agentskills.io 开放标准）装载注册表。
 * 扫描技能目录（`skills/<name>/SKILL.md` + YAML frontmatter），解析校验后
 * 提供生效清单（发现且未禁用）与按名读取正文（渐进式披露第二层——第一层
 * 是 prompt 中仅含 name + description 的索引，见 skill 工具 promptDetail）。
 * 会话启动时构造加载一次，会话期内不可变（对齐工具面装配期确定语义）。
 */
import { readdir, readFile } from "node:fs/promises";
import { realpath } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { parse as parseYaml } from "yaml";

/** 技能来源层级 */
export type SkillSource = "app" | "project";

/** 已发现技能记录（frontmatter 解析产物） */
export interface SkillRecord {
  /** 技能名（frontmatter name；`/^[a-z0-9-]+$/` 且 ≤64 字符） */
  readonly name: string;
  /** 简介（frontmatter description；≤1024 字符，超长截断） */
  readonly description: string;
  /** 来源层级（app=应用级 / project=项目级；同名时 project 覆盖 app） */
  readonly source: SkillSource;
  /** 技能目录绝对路径 */
  readonly dir: string;
  /** SKILL.md 绝对路径 */
  readonly file: string;
}

/** 扫描失败条目（单个技能解析失败跳过并记录，不阻断整体装载） */
export interface SkillScanError {
  /** 失败的技能目录 */
  readonly dir: string;
  /** 中文原因 */
  readonly reason: string;
}

/** 技能目录描述（root + 来源层级） */
export interface SkillDir {
  /** 技能根目录（其下每个子目录是一个技能） */
  readonly root: string;
  /** 来源层级 */
  readonly source: SkillSource;
}

/** 技能名合法约束（agentskills.io 规范：小写字母/数字/连字符，≤64 字符） */
export const SKILL_NAME_PATTERN = /^[a-z0-9-]+$/;

/** 技能名长度上限 */
export const SKILL_NAME_MAX_LENGTH = 64;

/** 简介/描述截断上限（渲染与记录统一） */
export const SKILL_DESCRIPTION_MAX_LENGTH = 1024;

/** SKILL.md 正文读取上限（对齐 NovelGlobalConstraints 的 256 KiB） */
export const SKILL_BODY_MAX_BYTES = 256 * 1024;

/** 捆绑资源文件读取上限（对齐 runtime/files Read 的 512 KiB；超限截断附尾注） */
export const BUNDLED_FILE_MAX_CHARS = 512 * 1024;

/** 技能内相对路径长度上限 */
const PATH_MAX = 1024;

/** SKILL.md 文件名（开放标准固定） */
export const SKILL_FILE_NAME = "SKILL.md";

/**
 * 解析 SKILL.md：YAML frontmatter（首行 `---` 围栏）+ Markdown 正文。
 * @param raw 文件全文
 * @returns frontmatter 文本与正文；非法结构返回 undefined
 */
export function parseSkillMarkdown(
  raw: string,
): { frontmatter: string; body: string } | undefined {
  const lines = raw.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return undefined;
  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === "---") {
      close = i;
      break;
    }
  }
  if (close === -1) return undefined;
  const frontmatter = lines.slice(1, close).join("\n");
  const body = lines.slice(close + 1).join("\n").replace(/^\n/, "");
  return { frontmatter, body };
}

/**
 * 技能装载注册表：构造后 load() 扫描解析一次，之后只读。
 */
export class SkillRegistry {
  private readonly dirs: readonly SkillDir[];
  private readonly disabled: ReadonlySet<string>;
  private skills: readonly SkillRecord[] = [];
  private errors: readonly SkillScanError[] = [];

  /**
   * @param options 技能目录列表（顺序即优先级：后面的 source 覆盖前面同名项）+ 禁用名单
   */
  constructor(options: { dirs: readonly SkillDir[]; disabled?: readonly string[] }) {
    this.dirs = options.dirs;
    this.disabled = new Set(options.disabled ?? []);
  }

  /** 扫描全部目录并解析（目录不存在视为空集；单技能失败记录进 errors） */
  async load(): Promise<void> {
    const byName = new Map<string, SkillRecord>();
    const errors: SkillScanError[] = [];
    for (const dir of this.dirs) {
      const entries = await readdir(dir.root, { withFileTypes: true }).catch(() => undefined);
      if (entries === undefined) {
        // 目录不存在/不可读：视为空集
        continue;
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const skillDir = join(dir.root, entry.name);
        const file = join(skillDir, SKILL_FILE_NAME);
        let raw: string;
        try {
          raw = await readFile(file, "utf8");
        } catch {
          errors.push({ dir: skillDir, reason: `缺少 ${SKILL_FILE_NAME}` });
          continue;
        }
        const parsed = parseSkillRecord(raw, skillDir, file, dir.source);
        if (parsed === undefined) {
          errors.push({ dir: skillDir, reason: "frontmatter 缺少合法的 name/description" });
          continue;
        }
        byName.set(parsed.name, parsed);
      }
    }
    this.skills = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
    this.errors = errors;
  }

  /** 全部已发现技能（含禁用；按名排序） */
  list(): readonly SkillRecord[] {
    return this.skills;
  }

  /** 扫描失败清单（诊断用） */
  scanErrors(): readonly SkillScanError[] {
    return this.errors;
  }

  /** 生效技能 = 已发现且未禁用 */
  effective(): readonly SkillRecord[] {
    return this.skills.filter((s) => !this.disabled.has(s.name));
  }

  /** 按名取已发现记录（不含禁用过滤） */
  get(name: string): SkillRecord | undefined {
    return this.skills.find((s) => s.name === name);
  }

  /** 名字是否生效（发现且未禁用） */
  isEffective(name: string): boolean {
    return this.get(name) !== undefined && !this.disabled.has(name);
  }

  /** 是否被显式禁用（已发现但名单内） */
  isDisabled(name: string): boolean {
    return this.get(name) !== undefined && this.disabled.has(name);
  }

  /** 禁用名单（快照） */
  disabledNames(): readonly string[] {
    return [...this.disabled];
  }

  /**
   * 读取技能正文（剥离 frontmatter；超 256 KiB 截断）。
   * @param name 技能名
   * @returns 正文 Markdown；记录不存在或读取失败返回 undefined
   */
  async readBody(name: string): Promise<string | undefined> {
    const record = this.get(name);
    if (record === undefined) return undefined;
    let raw: string;
    try {
      raw = await readFile(record.file, "utf8");
    } catch {
      return undefined;
    }
    const parsed = parseSkillMarkdown(raw);
    const body = parsed?.body ?? raw;
    return body.length > SKILL_BODY_MAX_BYTES ? body.slice(0, SKILL_BODY_MAX_BYTES) : body;
  }

  /**
   * 读取技能捆绑资源文件（references/scripts 等技能内相对路径）。
   * 技能级只读小沙盒：解析后不得逃逸技能目录（拒绝绝对路径与 `..`），
   * realpath 防符号链接逃逸（对齐 runtime/files 的防护强度）。
   * @param record 技能记录（须已发现）
   * @param path 技能内相对路径（如 "references/schemas.md"）
   * @returns 文件文本（超 512 KiB 截断并附尾注）；路径非法抛错、文件不存在返回 undefined
   */
  async readBundledFile(record: SkillRecord, path: string): Promise<string | undefined> {
    if (path.length === 0 || path.includes("\0") || path.length > PATH_MAX) {
      throw new Error(`非法的技能内路径: ${path}`);
    }
    const abs = resolve(record.dir, path);
    const rel = relative(record.dir, abs);
    if (rel === "" || rel.startsWith("..") || rel.split(sep)[0] === "..") {
      throw new Error(`路径逃逸技能目录: ${path}`);
    }
    // symlink 防护：真实位置必须仍在技能目录内
    const dirReal = await realpathSafe(record.dir);
    const real = await realpathSafe(abs);
    if (dirReal !== undefined && real !== undefined) {
      const realRel = relative(dirReal, real);
      if (realRel.startsWith("..") || realRel.split(sep)[0] === "..") {
        throw new Error(`路径经符号链接逃逸技能目录: ${path}`);
      }
    }
    let content: string;
    try {
      content = await readFile(abs, "utf8");
    } catch {
      return undefined;
    }
    return content.length > BUNDLED_FILE_MAX_CHARS
      ? `${content.slice(0, BUNDLED_FILE_MAX_CHARS)}\n\n[已截断，原文件 ${content.length} 字符]`
      : content;
  }
}

/** realpath 包装：路径不存在返回 undefined */
async function realpathSafe(p: string): Promise<string | undefined> {
  try {
    return await realpath(p);
  } catch {
    return undefined;
  }
}

/**
 * 从 SKILL.md 全文解析技能记录（frontmatter 校验 + description 截断）。
 * @returns 合法记录；name/description 缺失或非法返回 undefined
 */
function parseSkillRecord(
  raw: string,
  dir: string,
  file: string,
  source: SkillSource,
): SkillRecord | undefined {
  const parsed = parseSkillMarkdown(raw);
  if (parsed === undefined) return undefined;
  let fields: Record<string, unknown>;
  try {
    const yaml = parseYaml(parsed.frontmatter);
    if (typeof yaml !== "object" || yaml === null) return undefined;
    fields = yaml as Record<string, unknown>;
  } catch {
    return undefined;
  }
  const name = fields.name;
  const description = fields.description;
  if (
    typeof name !== "string" ||
    name.length === 0 ||
    name.length > SKILL_NAME_MAX_LENGTH ||
    !SKILL_NAME_PATTERN.test(name)
  ) {
    return undefined;
  }
  if (typeof description !== "string" || description.trim().length === 0) {
    return undefined;
  }
  return {
    name,
    description:
      description.length > SKILL_DESCRIPTION_MAX_LENGTH
        ? description.slice(0, SKILL_DESCRIPTION_MAX_LENGTH)
        : description,
    source,
    dir,
    file,
  };
}

/**
 * 渲染技能索引（skill.index 动态段内容）：仅 name + description
 * 单行清单 + 使用指引，正文不进 prompt（渐进式披露第一层）。空清单返回空串（整段省略）。
 * @param skills 生效技能条目（SkillRecord 或其 name/description 投影均可）
 * @returns 索引文本（空串 = 无技能，省略）
 */
export function renderSkillIndex(
  skills: readonly { readonly name: string; readonly description: string }[],
): string {
  if (skills.length === 0) return "";
  const lines = [
    "# 技能（Skills）",
    "以下技能已装载（此处仅列名称与简介）。需要运用某项技能时，先调用 skill 工具（参数 name）读取其完整说明，理解后再按说明开展工作：",
  ];
  for (const skill of skills) {
    lines.push(`- ${skill.name} — ${skill.description}`);
  }
  lines.push("未列出的技能不存在；不要凭空假设技能内容。");
  return lines.join("\n");
}
