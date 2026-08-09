/**
 * runtime.files 工具语义：workspace 沙盒 + Read/Glob/Write/Edit 纯逻辑。
 * File tool semantics for the runtime.files group: workspace sandbox plus Read/Glob/Write/Edit logic.
 *
 * 沙盒根目录 = workspace 根；所有 file ops 使用**基于 workspace 的相对路径**
 * （对齐 CCB，参考 docs/ccb-runtime-files-reference.md）。绝对路径一律拒绝
 * （pathForbidden）；越出沙盒（.. / symlink 逃逸）同样 pathForbidden。
 * 代码自研，不依赖 tool 协议。
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
  /** workspace 根目录绝对路径（沙盒根）。Absolute path to the workspace sandbox root. */
  readonly sandboxRoot: string;
  /** 单次读写字节上限。Per-call byte cap for read/write. */
  readonly maxFileBytes?: number;
  readonly logger?: Logger;
}

export type FileReadDetails = {
  readonly file_path: string;
  readonly content: string;
  readonly sizeBytes: number;
  readonly totalLines: number;
  readonly truncated: boolean;
};

export type FileGlobDetails = {
  readonly matches: string[];
};

export type FileWriteDetails = {
  readonly file_path: string;
  readonly sizeBytes: number;
};

export type FileEditDetails = {
  readonly file_path: string;
  readonly sizeBytes: number;
};

const DEFAULT_MAX_FILE_BYTES = 512 * 1024;

/** 提供 Read/Glob/Write/Edit 的 provider-neutral 服务。 */
/** Provider-neutral service backing the Read/Glob/Write/Edit tools. */
export class FileToolService {
  readonly #sandboxRoot: string;
  readonly #maxFileBytes: number;
  readonly #logger: Logger;

  constructor(options: FileToolServiceOptions) {
    this.#sandboxRoot = path.resolve(options.sandboxRoot);
    this.#maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
    this.#logger = (options.logger ?? noopLogger).child({
      component: "file_tool_service",
    });
  }

  /** 读取 workspace 内文件（可选行范围）。Read a file inside the workspace. */
  async read(requested: string, offset = 0, limit?: number): Promise<FileReadDetails> {
    const resolved = await this.#resolveWithinSandbox(requested, { mustExist: true });
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
        `workspace file content exceeds ${this.#maxFileBytes} bytes; use offset/limit`,
      );
    }
    this.#logger.debug("file_tool.read", {
      sizeBytes,
      totalLines,
      truncated: end < totalLines,
    });
    return Object.freeze({
      file_path: toWorkspaceRelative(this.#sandboxRoot, resolved),
      content,
      sizeBytes,
      totalLines,
      truncated: end < totalLines,
    });
  }

  /** 在 workspace 内按模式找文件，返回 workspace 相对路径并按 mtime 降序。 */
  /** Glob within the workspace; returns workspace-relative paths sorted by mtime descending. */
  async glob(pattern: string): Promise<FileGlobDetails> {
    this.#assertSafePattern(pattern);
    const matcher = compileGlob(pattern);
    const found: { filePath: string; mtimeMs: number }[] = [];
    await this.#walk(this.#sandboxRoot, (filePath) => {
      const relative = path.relative(this.#sandboxRoot, filePath).split(path.sep).join("/");
      if (matcher(relative)) {
        found.push({ filePath, mtimeMs: 0 });
      }
    });
    for (const entry of found) {
      const stat = await fs.stat(entry.filePath);
      entry.mtimeMs = stat.mtimeMs;
    }
    found.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return Object.freeze({
      matches: found.map((entry) =>
        toWorkspaceRelative(this.#sandboxRoot, entry.filePath),
      ),
    });
  }

  /** 整文件原子写入；路径必须在 workspace 沙盒内。 */
  /** Atomic full-file write; the path must stay inside the workspace sandbox. */
  async write(filePath: string, content: string): Promise<FileWriteDetails> {
    const target = await this.#resolveWithinSandbox(filePath, { mustExist: false });
    const sizeBytes = Buffer.byteLength(content, "utf8");
    if (sizeBytes > this.#maxFileBytes) {
      throw new FileToolError(
        FILE_TOOL_ERROR_CODE.tooLarge,
        `workspace file content exceeds ${this.#maxFileBytes} bytes`,
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
    return Object.freeze({ file_path: toWorkspaceRelative(this.#sandboxRoot, target), sizeBytes });
  }

  /** 增量编辑（replace_all=false 替换第一个；true 全部替换）。 */
  /** Incremental edit: replace_all=false replaces the first match; true replaces all. */
  async edit(
    filePath: string,
    oldString: string,
    newString: string,
    replaceAll = false,
  ): Promise<FileEditDetails> {
    const target = await this.#resolveWithinSandbox(filePath, { mustExist: true });
    let raw: string;
    try {
      raw = await fs.readFile(target, "utf8");
    } catch (error) {
      throw new FileToolError(
        FILE_TOOL_ERROR_CODE.notFound,
        `workspace file not found: ${target}`,
      );
    }
    if (!raw.includes(oldString)) {
      throw new FileToolError(
        FILE_TOOL_ERROR_CODE.editMissing,
        "old_string was not found in the workspace file; provide more context",
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
    return Object.freeze({ file_path: toWorkspaceRelative(this.#sandboxRoot, target), sizeBytes });
  }

  /** 解析并校验路径：必须落在 workspace 沙盒内（防 ../、绝对路径越界与 symlink 逃逸）。 */
  /** Resolve and validate a path: must stay inside the workspace sandbox. */
  async #resolveWithinSandbox(
    requested: string,
    options: { mustExist: boolean },
  ): Promise<string> {
    const rootReal = await fs.realpath(this.#sandboxRoot);
    // 只用 workspace 相对路径：绝对路径直接拒绝。相对路径基于 workspace 根解析
    // （而非进程 CWD）。Relative paths resolve against the workspace root (not the
    // process CWD); absolute paths are rejected outright.
    if (path.isAbsolute(requested)) {
      throw new FileToolError(
        FILE_TOOL_ERROR_CODE.pathForbidden,
        `path must be relative to the workspace directory: ${requested}`,
      );
    }
    const requestedResolved = path.resolve(this.#sandboxRoot, requested);
    const rel = path.relative(this.#sandboxRoot, requestedResolved);
    if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new FileToolError(
        FILE_TOOL_ERROR_CODE.pathForbidden,
        `path escapes the workspace directory: ${requested}`,
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
          `workspace file not found: ${requested}`,
        );
      }
    }
    if (!isInside(rootReal, resolved)) {
      throw new FileToolError(
        FILE_TOOL_ERROR_CODE.pathForbidden,
        `path escapes the workspace directory via symlink: ${requested}`,
      );
    }
    return resolved;
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

/** 绝对路径 → workspace 相对路径（统一正斜杠，便于 agent 回喂 Read）。 */
/** Absolute path -> workspace-relative path (forward slashes so the agent can feed it back). */
function toWorkspaceRelative(root: string, abs: string): string {
  return path.relative(root, abs).split(path.sep).join("/");
}

function isInside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

/** 用 picomatch 编译 glob（dot 开）为相对路径匹配器。Compile a glob matcher with picomatch. */
function compileGlob(pattern: string): (relative: string) => boolean {
  const matches = picomatch(pattern, { dot: true });
  return (relative) => matches(relative);
}
