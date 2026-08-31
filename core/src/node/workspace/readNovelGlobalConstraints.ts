/**
 * 每调用读取小说全局约束文件（NOVEL.md，两层）：缺失/超限/读取失败一律返回
 * undefined（不抛错；路径/内容不进日志），由 novel.global_constraints 动态段渲染
 * 占位或仅渲染另一层。
 * Reads the layered novel global-constraints files (NOVEL.md) per call:
 * missing / oversized / read failures all return undefined (never throws;
 * path and content are never logged); the novel.global_constraints dynamic
 * section renders the other layer or the placeholder instead.
 */
import { stat, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Logger } from "../../log/Logger.js";
import type { NovelGlobalConstraintsSnapshot } from "../../runtime/prompt/PromptSection.js";

/** 小说全局约束默认文件名（沙盒根下相对路径） */
export const NOVEL_GLOBAL_CONSTRAINTS_FILE_NAME = "NOVEL.md";
/** 文件大小上限（超出视为不可用，防大文件吞 prompt；fail-loud 拒绝，非截断） */
export const NOVEL_GLOBAL_CONSTRAINTS_MAX_BYTES = 256 * 1024;

/** 全局层 NOVEL.md 绝对路径 env（GUI main 注入 userData 目录；未设 = 无全局层） */
export const NOVEL_GLOBAL_CONSTRAINTS_PATH_ENV = "NOVEL_GLOBAL_CONSTRAINTS";

/**
 * 读取单个约束文件（安全版，绝对路径）
 * @param target 文件绝对路径
 * @param logger 结构化日志（可省略；失败只记 debug 级 failure 码，不记路径/内容）
 * @returns 文件内容（UTF-8）；缺失/非文件/超限/读取失败返回 undefined
 */
async function readConstraintsFileSafe(target: string, logger?: Logger): Promise<string | undefined> {
  try {
    const fileStat = await stat(target);
    if (!fileStat.isFile()) {
      return undefined;
    }
    if (fileStat.size > NOVEL_GLOBAL_CONSTRAINTS_MAX_BYTES) {
      logger?.debug("novel_global_constraints.too_large");
      return undefined;
    }
    return await readFile(target, "utf8");
  } catch (error) {
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      // 文件缺失（新项目常态）/目录不存在：静默返回 undefined，不打日志
      return undefined;
    }
    logger?.debug("novel_global_constraints.read_failed", {
      failure:
        error instanceof Error
          ? ((error as NodeJS.ErrnoException).code ?? error.name)
          : "unknown",
    });
    return undefined;
  }
}

/**
 * 读取小说全局约束文件内容（安全版）
 * @param workdir 工作区根目录（沙盒根）
 * @param logger 结构化日志（可省略；失败只记 debug 级 failure 码，不记路径/内容）
 * @returns 文件内容（UTF-8）；缺失/非文件/超限/读取失败返回 undefined
 */
export async function readNovelGlobalConstraintsSafe(
  workdir: string,
  logger?: Logger,
): Promise<string | undefined> {
  return readConstraintsFileSafe(join(workdir, NOVEL_GLOBAL_CONSTRAINTS_FILE_NAME), logger);
}

/**
 * 读取两层静态声明（PRD memory-两层记忆 M1）：项目层 = workspace 根 NOVEL.md，
 * 全局层 = globalPath（GUI userData 下 NOVEL.md）。两层各自 fail-loud（一层超限/
 * 读取失败不影响另一层注入）。
 * @param workdir 工作区根目录（项目层）
 * @param globalPath 全局层 NOVEL.md 绝对路径（undefined = 无全局层装配）
 * @param logger 结构化日志
 * @returns 分层快照；两层都缺失时返回 undefined（动态段渲染占位）
 */
export async function readNovelGlobalConstraintsLayersSafe(
  workdir: string,
  globalPath: string | undefined,
  logger?: Logger,
): Promise<NovelGlobalConstraintsSnapshot | undefined> {
  const [project, global] = await Promise.all([
    readNovelGlobalConstraintsSafe(workdir, logger),
    globalPath === undefined || globalPath.trim() === ""
      ? undefined
      : readConstraintsFileSafe(globalPath, logger),
  ]);
  if (project === undefined && global === undefined) return undefined;
  return {
    ...(global !== undefined ? { global } : {}),
    ...(project !== undefined ? { project } : {}),
  };
}
