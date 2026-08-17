/**
 * 每调用读取小说全局约束文件（NOVEL.md）：缺失/超限/读取失败一律返回 undefined
 * （不抛错；路径/内容不进日志），由 novel.global_constraints 动态段渲染占位。
 * Reads the novel global-constraints file (NOVEL.md) per call: missing /
 * oversized / read failures all return undefined (never throws; path and content
 * are never logged); the novel.global_constraints dynamic section renders the
 * placeholder instead.
 */
import { stat, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Logger } from "../../log/Logger.js";

/** 小说全局约束默认文件名（沙盒根下相对路径） */
export const NOVEL_GLOBAL_CONSTRAINTS_FILE_NAME = "NOVEL.md";
/** 文件大小上限（超出视为不可用，防大文件吞 prompt） */
export const NOVEL_GLOBAL_CONSTRAINTS_MAX_BYTES = 256 * 1024;

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
  const target = join(workdir, NOVEL_GLOBAL_CONSTRAINTS_FILE_NAME);
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
      // 文件缺失（新项目常态）/workdir 不存在：静默返回 undefined，不打日志
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
