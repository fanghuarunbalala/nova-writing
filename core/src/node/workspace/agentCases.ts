/**
 * compose 案例引导（novel-guide）资源层（PRD compose-案例引导 v0.3）：
 * - 母版 core/resources/agent-cases（构建期经 scripts/copy-resources.mjs 拷入
 *   dist/resources 随包分发；运行时从模块目录向上查找，env 可覆盖）；
 * - 运行时副本 <workspace>/.novel/cases——seed-if-absent（存在即跳过，
 *   **永不覆盖**用户本地改动）；
 * - 索引动态派生：扫描 .novel/cases/*.md 的 front-matter（扁平 key: value
 *   手写解析，不引 YAML 依赖），**无 INDEX.md**——加/删案例 = 单文件操作，
 *   索引与目录永不漂移。
 * 所有失败一律降级（undefined / false），不抛错、不阻断 spawn（对齐
 * readNovelGlobalConstraints 的安全读取语义）。
 */
import { cp, mkdir, readdir, readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Logger } from "../../log/Logger.js";
import type { GuideCaseEntry } from "../../runtime/agent/composeGuide/types.js";

/** 案例运行时目录（workspace 相对；展示用正斜杠） */
export const AGENT_CASES_DIR = ".novel/cases";
/** 单份案例大小上限（对齐 NOVEL.md，防大文件吞 prompt） */
export const AGENT_CASE_MAX_BYTES = 256 * 1024;
/** front-matter 围栏内最多解析行数（防格式异常文件拖慢扫描） */
const FRONT_MATTER_MAX_LINES = 32;
/** 母版向上查找最大层级（dist/node/workspace → dist/resources 等布局） */
const MASTER_SEARCH_DEPTH = 5;
/** 母版目录 env 覆盖（测试/定制用） */
const MASTER_DIR_ENV = "NOVEL_AGENT_CASES_DIR";

/**
 * 解析案例 front-matter（纯函数）：`---` 围栏内按行 `key: value`（trim + 剥引号）。
 * "-" / 空串 = 该维度缺省；缺 task_type、无围栏、围栏未闭合 → undefined（整份跳过）。
 * @param file 文件名（.novel/cases/ 内）
 * @param content 文件全文（UTF-8）
 * @returns 案例条目；不可解析返回 undefined
 */
export function parseAgentCaseFrontMatter(file: string, content: string): GuideCaseEntry | undefined {
  const lines = content.split("\n");
  if (lines[0]?.trim() !== "---") return undefined;
  let end = -1;
  for (let i = 1; i <= Math.min(lines.length - 1, FRONT_MATTER_MAX_LINES); i++) {
    if (lines[i]?.trim() === "---") {
      end = i;
      break;
    }
  }
  if (end === -1) return undefined;
  const fields = new Map<string, string>();
  for (const line of lines.slice(1, end)) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue; // 坏行跳过（空行/无冒号行）
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
    if (key.length > 0) fields.set(key, value);
  }
  const read = (key: string): string | undefined => {
    const value = fields.get(key);
    return value !== undefined && value !== "" && value !== "-" ? value : undefined;
  };
  const taskType = read("task_type");
  if (taskType === undefined) return undefined;
  const orderRaw = fields.get("order");
  const order =
    orderRaw !== undefined && /^\d+$/.test(orderRaw.trim()) ? Number(orderRaw.trim()) : undefined;
  return {
    file,
    path: `${AGENT_CASES_DIR}/${file}`,
    taskType,
    ...(read("character_type") !== undefined ? { characterType: read("character_type") } : {}),
    ...(read("situation") !== undefined ? { situation: read("situation") } : {}),
    summary: fields.get("summary")?.trim() ?? "",
    ...(order !== undefined ? { order } : {}),
  };
}

/**
 * 解析 app 母版目录：NOVEL_AGENT_CASES_DIR env → 自模块目录向上找
 * resources/agent-cases（兼容 dist/ 与 src/ 两种布局）。找不到返回 undefined。
 * @returns 母版绝对路径；不可用返回 undefined
 */
export async function resolveAgentCasesMasterDir(): Promise<string | undefined> {
  const envDir = process.env[MASTER_DIR_ENV];
  if (envDir !== undefined && envDir.trim() !== "") return envDir.trim();
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < MASTER_SEARCH_DEPTH; depth++) {
    const candidate = join(dir, "resources", "agent-cases");
    try {
      if ((await stat(candidate)).isDirectory()) return candidate;
    } catch {
      // 不存在继续上探
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

/**
 * seed 运行时案例目录：<workspace>/.novel/cases 缺失才从母版整体拷贝
 * （存在即跳过、永不覆盖用户改动）。母版不可用/拷贝失败返回 false（降级）。
 * @param workspace 工作区根目录（沙盒根）
 * @param logger 结构化日志（可省略；失败只记 debug 级码）
 * @returns 是否执行了拷贝
 */
export async function seedAgentCasesIfNeeded(workspace: string, logger?: Logger): Promise<boolean> {
  const target = join(workspace, AGENT_CASES_DIR);
  try {
    await stat(target);
    return false; // 存在即跳过（seed-if-absent：用户本地改动优先）
  } catch {
    // 缺失才 seed
  }
  const master = await resolveAgentCasesMasterDir();
  if (master === undefined) {
    logger?.debug("agent_cases.master_missing");
    return false;
  }
  try {
    await mkdir(dirname(target), { recursive: true });
    await cp(master, target, { recursive: true });
    logger?.info("agent_cases.seeded");
    return true;
  } catch (error) {
    logger?.debug("agent_cases.seed_failed", {
      failure:
        error instanceof Error
          ? ((error as NodeJS.ErrnoException).code ?? error.name)
          : "unknown",
    });
    return false;
  }
}

/** 扫描缓存（进程单会话单 workspace；mtime 变更才重扫） */
let scanCache: { workspace: string; mtimeMs: number; entries: GuideCaseEntry[] } | undefined;

/** 清空扫描缓存（测试用：强制下次 scanAgentCases 重扫） */
export function clearAgentCasesScanCache(): void {
  scanCache = undefined;
}

/**
 * 扫描运行时案例目录 → 案例条目（按 order 缺省文件名序）。以目录 mtimeMs
 * 记忆化（每 call 一次 stat；增删/改名触发重扫——文件内容就地编辑不触发，
 * 案例集以结构变更为刷新语义）。目录缺失/不可读返回 undefined。
 * @param workspace 工作区根目录
 * @param logger 结构化日志（可省略；单份跳过只记 debug）
 * @returns 案例条目（可为空数组=库存在但无有效案例）；目录缺失返回 undefined
 */
export async function scanAgentCases(
  workspace: string,
  logger?: Logger,
): Promise<GuideCaseEntry[] | undefined> {
  const dir = join(workspace, AGENT_CASES_DIR);
  let dirStat;
  try {
    dirStat = await stat(dir);
  } catch {
    return undefined;
  }
  if (!dirStat.isDirectory()) return undefined;
  if (
    scanCache !== undefined &&
    scanCache.workspace === workspace &&
    scanCache.mtimeMs === dirStat.mtimeMs
  ) {
    return scanCache.entries;
  }
  const files = (await readdir(dir, { withFileTypes: true }))
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => e.name)
    .sort();
  const entries: GuideCaseEntry[] = [];
  for (const file of files) {
    try {
      const content = await readFile(join(dir, file), "utf-8");
      const entry = parseAgentCaseFrontMatter(file, content);
      if (entry !== undefined) {
        entries.push(entry);
      } else {
        logger?.debug("agent_cases.front_matter_skipped", { file });
      }
    } catch (error) {
      logger?.debug("agent_cases.read_failed", {
        file,
        failure:
          error instanceof Error
            ? ((error as NodeJS.ErrnoException).code ?? error.name)
            : "unknown",
      });
    }
  }
  entries.sort(
    (a, b) =>
      (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) ||
      a.file.localeCompare(b.file),
  );
  scanCache = { workspace, mtimeMs: dirStat.mtimeMs, entries };
  return entries;
}

/**
 * 读取单份案例全文（安全版）：缺失/非文件/超限/读取失败返回 undefined（不抛错）。
 * @param workspace 工作区根目录
 * @param file 案例文件名（.novel/cases/ 内，来自扫描条目）
 * @returns 文件内容（UTF-8）；不可用返回 undefined
 */
export async function readAgentCaseContent(
  workspace: string,
  file: string,
): Promise<string | undefined> {
  const target = join(workspace, AGENT_CASES_DIR, file);
  try {
    const fileStat = await stat(target);
    if (!fileStat.isFile() || fileStat.size > AGENT_CASE_MAX_BYTES) return undefined;
    return await readFile(target, "utf-8");
  } catch {
    return undefined;
  }
}

/**
 * 渲染索引文本（每案一行：路径｜标签｜摘要），供 novel.compose.guide 动态段注入。
 * @param entries 案例条目（已排序）
 * @returns 索引文本
 */
export function renderAgentCasesIndex(entries: readonly GuideCaseEntry[]): string {
  return entries
    .map((e) => {
      const tags = [`task=${e.taskType}`];
      if (e.characterType !== undefined) tags.push(`character=${e.characterType}`);
      if (e.situation !== undefined) tags.push(`situation=${e.situation}`);
      const summary = e.summary !== "" ? ` ｜ ${e.summary}` : "";
      return `- ${e.path} ｜ ${tags.join(" ")}${summary}`;
    })
    .join("\n");
}
