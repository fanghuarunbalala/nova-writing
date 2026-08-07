/**
 * runtime.files 工具语义：路径沙箱 + Read/Glob/Write/Edit 纯逻辑。
 * File tool semantics for the runtime.files group: path sandbox plus Read/Glob/Write/Edit logic.
 *
 * 参数与行为对齐 CCB（参考 docs/ccb-runtime-files-reference.md）；作用域收敛到
 * design 目录（读）与当前会话 design 文件（写）。代码自研，不依赖 tool 协议。
 */
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import picomatch from "picomatch";
import { noopLogger, type Logger } from "../../observability/index.js";

export const FILE_TOOL_ERROR_CODE = Object.freeze({
  pathForbidden: "NOVEL_DESIGN_FILE_PATH_FORBIDDEN",
  tooLarge: "NOVEL_DESIGN_FILE_TOO_LARGE",
  notFound: "NOVEL_DESIGN_FILE_NOT_FOUND",
  editMissing: "NOVEL_DESIGN_EDIT_MISSING",
} as const);

export type FileToolErrorCode =
  (typeof FILE_TOOL_ERROR_CODE)[keyof typeof FILE_TOOL_ERROR_CODE];

/** 文件工具领域错误：携带稳定错误码，由工具 handler 映射为 ToolError。 */
/** Domain error for file tools: carries a stable code mapped to ToolError by the tool handler. */
export class FileToolError extends Error {
  readonly code: FileToolErrorCode;

  constructor(code: FileToolErrorCode, message: string) {
    super(message);
    this.name = "FileToolError";
    this.code = code;
  }
}

export interface FileToolServiceOptions {
  /** design 目录绝对路径（读作用域根）。Absolute path to the design directory. */
  readonly designRoot: string;
  /** 当前会话 design 文件绝对路径（写作用域，M1 阶段可缺省）。 */
  /** Absolute path to the current conversation design file (write scope; optional in M1). */
  readonly designFilePath?: string;
  /** 单次读写字节上限。Per-call byte cap for read/write. */
  readonly maxFileBytes?: number;
  readonly logger?: Logger;
}

export interface FileReadDetails {
  readonly file_path: string;
  readonly content: string;
  readonly sizeBytes: number;
  readonly totalLines: number;
  readonly truncated: boolean;
}

export interface FileGlobDetails {
  readonly matches: readonly string[];
}

export interface FileWriteDetails {
  readonly file_path: string;
  readonly sizeBytes: number;
}

export interface FileEditDetails {
  readonly file_path: string;
  readonly sizeBytes: number;
}

const DEFAULT_MAX_FILE_BYTES = 512 * 1024;

/** 提供 Read/Glob/Write/Edit 的 provider-neutral 服务。 */
/** Provider-neutral service backing the Read/Glob/Write/Edit tools. */
export class FileToolService {
  readonly #designRoot: string;
  readonly #designFilePath: string | undefined;
  readonly #maxFileBytes: number;
  readonly #logger: Logger;

  constructor(options: FileToolServiceOptions) {
    this.#designRoot = path.resolve(options.designRoot);
    this.#designFilePath =
      options.designFilePath === undefined
        ? undefined
        : path.resolve(options.designFilePath);
    this.#maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
    this.#logger = (options.logger ?? noopLogger).child({
      component: "file_tool_service",
    });
  }

  /** 读取 design 目录内文件（可选行范围）。Read a file inside the design directory. */
  async read(requested: string, offset = 0, limit?: number): Promise<FileReadDetails> {
    const resolved = await this.#resolveWithinDesignRoot(requested, { mustExist: true });
    const raw = await fs.readFile(resolved, "utf8");
    const lines = raw.split("\n");
    const totalLines = lines.length;
    const start = Math.max(0, offset);
    const end = limit === undefined ? lines.length : Math.min(lines.length, start + limit);
    const slice = lines.slice(start, end);
    const content = slice.join("\n");
    const sizeBytes = Buffer.byteLength(content, "utf8");
    if (sizeBytes > this.#maxFileBytes) {
      throw new FileToolError(
        FILE_TOOL_ERROR_CODE.tooLarge,
        `design file content exceeds ${this.#maxFileBytes} bytes; use offset/limit`,
      );
    }
    this.#logger.debug("file_tool.read", {
      sizeBytes,
      totalLines,
      truncated: end < totalLines,
    });
    return Object.freeze({
      file_path: resolved,
      content,
      sizeBytes,
      totalLines,
      truncated: end < totalLines,
    });
  }

  /** 在 design 目录内按模式找文件，返回绝对路径并按 mtime 降序。 */
  /** Glob within the design directory; returns absolute paths sorted by mtime descending. */
  async glob(pattern: string): Promise<FileGlobDetails> {
    this.#assertSafePattern(pattern);
    const matcher = compileGlob(pattern);
    const found: { filePath: string; mtimeMs: number }[] = [];
    await this.#walk(this.#designRoot, (filePath) => {
      if (matcher(path.relative(this.#designRoot, filePath))) {
        found.push({ filePath, mtimeMs: 0 });
      }
    });
    for (const entry of found) {
      const stat = await fs.stat(entry.filePath);
      entry.mtimeMs = stat.mtimeMs;
    }
    found.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return Object.freeze({
      matches: Object.freeze(found.map((entry) => entry.filePath)),
    });
  }

  /** 整文件原子写入；路径必须等于当前会话 design 文件。 */
  /** Atomic full-file write; the path must equal the current conversation design file. */
  async write(filePath: string, content: string): Promise<FileWriteDetails> {
    const target = await this.#requireDesignFile(filePath);
    const sizeBytes = Buffer.byteLength(content, "utf8");
    if (sizeBytes > this.#maxFileBytes) {
      throw new FileToolError(
        FILE_TOOL_ERROR_CODE.tooLarge,
        `design file content exceeds ${this.#maxFileBytes} bytes`,
      );
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    const tmp = `${target}.tmp-${randomUUID()}`;
    try {
      await fs.writeFile(tmp, content, "utf8");
      await fs.rename(tmp, target);
    } catch (error) {
      await fs.rm(tmp, { force: true }).catch(() => undefined);
      throw error;
    }
    this.#logger.debug("file_tool.write", { sizeBytes });
    return Object.freeze({ file_path: target, sizeBytes });
  }

  /** 增量编辑（replace_all=false 替换第一个；true 全部替换）。 */
  /** Incremental edit: replace_all=false replaces the first match; true replaces all. */
  async edit(
    filePath: string,
    oldString: string,
    newString: string,
    replaceAll = false,
  ): Promise<FileEditDetails> {
    const target = await this.#requireDesignFile(filePath);
    let raw: string;
    try {
      raw = await fs.readFile(target, "utf8");
    } catch (error) {
      throw new FileToolError(
        FILE_TOOL_ERROR_CODE.notFound,
        `design file not found: ${target}`,
      );
    }
    if (!raw.includes(oldString)) {
      throw new FileToolError(
        FILE_TOOL_ERROR_CODE.editMissing,
        "old_string was not found in the design file; provide more context",
      );
    }
    const next = replaceAll
      ? raw.split(oldString).join(newString)
      : raw.replace(oldString, newString);
    const sizeBytes = Buffer.byteLength(next, "utf8");
    const tmp = `${target}.tmp-${randomUUID()}`;
    try {
      await fs.writeFile(tmp, next, "utf8");
      await fs.rename(tmp, target);
    } catch (error) {
      await fs.rm(tmp, { force: true }).catch(() => undefined);
      throw error;
    }
    this.#logger.debug("file_tool.edit", { sizeBytes, replaceAll });
    return Object.freeze({ file_path: target, sizeBytes });
  }

  /** 解析并校验读路径：必须落在 design 目录内（防 ../ 与 symlink 逃逸）。 */
  /** Resolve and validate a read path: must stay inside the design directory. */
  async #resolveWithinDesignRoot(
    requested: string,
    options: { mustExist: boolean },
  ): Promise<string> {
    const rootReal = await fs.realpath(this.#designRoot);
    const rel = path.relative(this.#designRoot, path.resolve(requested));
    if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new FileToolError(
        FILE_TOOL_ERROR_CODE.pathForbidden,
        `path escapes the design directory: ${requested}`,
      );
    }
    // 基于真实根目录重建候选路径，规避 /var -> /private/var 等前缀差异。
    // Rebuild the candidate on the real root to absorb prefix symlinks like /var -> /private/var.
    const candidate = path.join(rootReal, rel);
    let resolved = candidate;
    try {
      resolved = await fs.realpath(candidate);
    } catch (error) {
      if (options.mustExist) {
        throw new FileToolError(
          FILE_TOOL_ERROR_CODE.notFound,
          `design file not found: ${requested}`,
        );
      }
    }
    if (!isInside(rootReal, resolved)) {
      throw new FileToolError(
        FILE_TOOL_ERROR_CODE.pathForbidden,
        `path escapes the design directory via symlink: ${requested}`,
      );
    }
    return resolved;
  }

  /** 校验写路径：必须等于当前会话 design 文件。 */
  /** Validate a write path: must equal the current conversation design file. */
  async #requireDesignFile(requested: string): Promise<string> {
    if (this.#designFilePath === undefined) {
      throw new FileToolError(
        FILE_TOOL_ERROR_CODE.pathForbidden,
        "no active design file for this conversation",
      );
    }
    const requestedResolved = await this.#resolveWithinDesignRoot(requested, {
      mustExist: false,
    });
    const target = await this.#resolveWithinDesignRoot(this.#designFilePath, {
      mustExist: false,
    });
    if (requestedResolved !== target) {
      throw new FileToolError(
        FILE_TOOL_ERROR_CODE.pathForbidden,
        "write target must be the current conversation design file",
      );
    }
    return target;
  }

  /** 禁止绝对模式与 `..` 逃逸。Reject absolute patterns and parent traversal. */
  #assertSafePattern(pattern: string): void {
    if (path.isAbsolute(pattern) || pattern.split(/[\\/]/).includes("..")) {
      throw new FileToolError(
        FILE_TOOL_ERROR_CODE.pathForbidden,
        `unsafe glob pattern: ${pattern}`,
      );
    }
  }

  async #walk(
    directory: string,
    onFile: (filePath: string) => void,
  ): Promise<void> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await this.#walk(full, onFile);
      } else if (entry.isFile()) {
        // 跳过符号链接：沙箱内不可读，避免泄露逃逸路径。
        // Skip symbolic links: unreadable inside the sandbox and may leak escapes.
        onFile(full);
      }
    }
  }
}

function isInside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

/** 用 picomatch 编译 glob（dot 开）为相对路径匹配器。Compile a glob matcher with picomatch. */
function compileGlob(pattern: string): (relative: string) => boolean {
  const matches = picomatch(pattern, { dot: true });
  return (relative) => matches(relative);
}
