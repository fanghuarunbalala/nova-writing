/**
 * runtime.files 工具组（Read / Glob / Write / Edit）——从旧 main 分支迁移。
 * 参数与行为对齐 CCB（file_path workspace 相对、沙盒限定、512KiB 上限）。
 *
 * ProjectFiles port（项目域上云 PRD FR5）：工具面只依赖接口，后端可换——
 * - LocalProjectFiles：本地 workspace（node:fs + 既有沙盒，现状逻辑原样）；
 * - RemoteProjectFiles：云项目（REST 到 server 文件 API，沙箱由 server 权威判定）；
 * 工具 schema / prompt 面不随后端变化（模型无感知）。
 */
import { readFile, writeFile, mkdir, readdir, rename, rm } from "node:fs/promises";
import { realpath } from "node:fs/promises";
import { join, resolve, relative, sep, dirname } from "node:path";
import type { ToolDef } from "../ToolDef.js";
import { fileReadPreview, fileGlobPreview, fileWritePreview, fileEditPreview } from "../previews.js";
import type { ToolCall } from "../../provider/types.js";
import { ToolError } from "../errors.js";

const PATH_MAX = 1024;
const CONTENT_MAX = 512 * 1024;

/** 文件后端原语：路径校验/沙盒由实现自持（工具不重复判定） */
export interface ProjectFiles {
  /** 读单个文件全文；不存在/越界抛错 */
  read(relPath: string): Promise<string>;
  /** 列出 prefix 前缀下的文件（相对路径 + 更新时间；本地可能不带 updatedAt） */
  list(prefix: string): Promise<Array<{ path: string; updatedAt?: number }>>;
  /** 整体写入（last-write-wins，对齐本地原子写语义；内容上限由实现/工具双重校验） */
  write(relPath: string, content: string): Promise<void>;
}

/** 沙盒路径解析：workspace 相对路径 → 绝对路径，校验不逃逸沙盒（含 symlink 防护） */
export async function resolveInWorkspace(workspace: string, filePath: string): Promise<string> {
  // 绝对形态显式拒绝（posix /、Windows 盘符、UNC \\）：resolve 会把它们当作外部根，
  // relative 跨根的行为不保证产生 ".." 前缀（UNC 即对拍实测漏网形态）
  if (filePath.startsWith("/") || filePath.startsWith("\\\\") || /^[a-zA-Z]:/.test(filePath)) {
    throw new Error(`路径逃逸 workspace 沙盒: ${filePath}`);
  }
  const abs = resolve(workspace, filePath);
  const rel = relative(workspace, abs);
  if (rel.startsWith("..") || rel.split(sep)[0] === ".." || abs === resolve(workspace)) {
    if (filePath !== "." && filePath !== "") {
      throw new Error(`路径逃逸 workspace 沙盒: ${filePath}`);
    }
  }
  if (filePath.includes("\0")) throw new Error("路径含非法字符");
  if (filePath.length > PATH_MAX) throw new Error("路径超长");
  // symlink 防护：对已存在的路径做 realpath，真实位置必须仍在 workspace 内
  //（否则 workspace 内指向外部的符号链接可让 Write/Edit 写穿沙盒）
  const wsReal = await realpathSafe(workspace);
  let probe = abs;
  for (;;) {
    const real = await realpathSafe(probe);
    if (real !== undefined) {
      const realRel = relative(wsReal ?? resolve(workspace), real);
      if (realRel.startsWith("..") || realRel.split(sep)[0] === "..") {
        throw new Error(`路径经符号链接逃逸 workspace 沙盒: ${filePath}`);
      }
      break;
    }
    const parent = dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }
  return abs;
}

/** realpath 包装：路径不存在返回 undefined（新建文件场景父目录逐级上探） */
async function realpathSafe(p: string): Promise<string | undefined> {
  try {
    return await realpath(p);
  } catch {
    return undefined;
  }
}

/** 原子写：temp 文件 + rename（崩溃不留半截文件；Windows rename 不覆盖已存在目标，先 rm） */
async function writeFileAtomic(abs: string, content: string): Promise<void> {
  const tmp = `${abs}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, content, "utf8");
  try {
    await rename(tmp, abs);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "EEXIST" || e.code === "EPERM" || e.code === "ENOTEMPTY") {
      // 目标已存在（Windows/exFAT rename 语义）：移除后重试一次
      await rm(tmp, { force: true });
      await rm(abs, { force: true });
      await writeFile(tmp, content, "utf8");
      await rename(tmp, abs);
      return;
    }
    await rm(tmp, { force: true });
    throw err;
  }
}

/** 本地 workspace 后端（现状逻辑原样收敛为 ProjectFiles） */
export class LocalProjectFiles implements ProjectFiles {
  constructor(private readonly workspace: string) {}

  async read(relPath: string): Promise<string> {
    const abs = await resolveInWorkspace(this.workspace, relPath);
    return readFile(abs, "utf8");
  }

  async list(prefix: string): Promise<Array<{ path: string }>> {
    const out: string[] = [];
    await walkList(this.workspace, this.workspace, out);
    return out
      .map((p) => p.split(sep).join("/"))
      .filter((p) => p.startsWith(prefix))
      .map((path) => ({ path }));
  }

  async write(relPath: string, content: string): Promise<void> {
    const abs = await resolveInWorkspace(this.workspace, relPath);
    await mkdir(dirname(abs), { recursive: true });
    await writeFileAtomic(abs, content);
  }
}

/** 递归列出全部文件（相对 workspace 原生分隔符） */
async function walkList(root: string, dir: string, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const abs = join(dir, e.name);
    if (e.isDirectory()) {
      await walkList(root, abs, out);
    } else {
      out.push(relative(root, abs));
    }
  }
}

/** 解析 tool args JSON，校验必填 file_path */
function parseArgs(call: ToolCall): Record<string, unknown> {
  try {
    return JSON.parse(call.args) as Record<string, unknown>;
  } catch {
    throw new ToolError(
      { code: "TOOL_ARGUMENTS_INVALID", toolName: call.name },
      `无效的 JSON 参数: ${call.args}`,
    );
  }
}

/**
 * 创建 files 四件套 ToolDef（后端可注入——本地 workspace 字符串或 ProjectFiles port）
 * @param backend workspace 绝对路径（本地项目）或 ProjectFiles 实现（云项目）
 * @param options approval=false 时 Write/Edit 免审批（后台非交互会话用，如
 *   BookAnalyst 的 analyst.files 组——无人应答审批，requireApproval 会永久挂起）
 * @returns Read/Glob/Write/Edit 四个工具定义
 */
export function createFileTools(
  backend: string | ProjectFiles,
  options?: { requireApproval?: boolean },
): ToolDef[] {
  // 文件写默认免审批：workspace 沙盒内、本地可逆，对齐主代理「本地可逆动作可以直接做」
  // （谨慎行动段）；显式 requireApproval: true 才强制征询（预留未来高风险文件会话）。
  const approval = options?.requireApproval === true;
  const files: ProjectFiles = typeof backend === "string" ? new LocalProjectFiles(backend) : backend;
  return [
    readTool(files),
    globTool(files),
    writeTool(files, approval),
    editTool(files, approval),
  ];
}

function readTool(files: ProjectFiles): ToolDef {
  return {
    name: "Read",
    version: "1.0.0",
    preview: fileReadPreview,
    description:
      "从 workspace 目录读取文件，使用 workspace 相对路径。\n\n用法：\n- file_path 必须是 workspace 相对路径，不能是绝对路径。\n- 结果按 cat -n 格式返回，行号从 1 开始。\n- 默认读取整个文件；可传 offset 行偏移和 limit 行数读取指定区间。\n- 超过 512 KiB 会报错，请分段读取。\n- 只读文件，不读目录；路径限定在 workspace 沙盒内。",
    parameters: {
      type: "object",
      properties: {
        file_path: { type: "string" },
        offset: { type: "integer" },
        limit: { type: "integer" },
      },
      required: ["file_path"],
      additionalProperties: false,
    },
    promptDetail: {
      policy: "",
      guidance: "",
    },
    handler: {
      execute: async (call) => {
        const args = parseArgs(call);
        const content = await files.read(String(args.file_path));
        if (content.length > CONTENT_MAX) throw new Error("文件超过 512 KiB，请分段读取");
        const lines = content.split("\n");
        const offset = typeof args.offset === "number" ? args.offset : 0;
        const limit = typeof args.limit === "number" ? args.limit : lines.length;
        const slice = lines.slice(offset, offset + limit);
        return slice.map((l, i) => `${offset + i + 1}\t${l}`).join("\n");
      },
    },
  };
}

function globTool(files: ProjectFiles): ToolDef {
  return {
    name: "Glob",
    version: "1.0.0",
    preview: fileGlobPreview,
    description:
      "在 workspace 目录内按 glob 模式查找文件（如 **/*.md）。\n\n用法：\n- pattern 是 workspace 相对 glob；绝对模式与父目录穿越会被拒绝。\n- 返回匹配文件路径（workspace 相对），按修改时间倒序。\n- 用 Glob 先发现文件，再用 Read 读取。\n- 路径限定在 workspace 沙盒内。",
    parameters: {
      type: "object",
      properties: { pattern: { type: "string" } },
      required: ["pattern"],
      additionalProperties: false,
    },
    promptDetail: {
      policy: "",
      guidance: "",
    },
    handler: {
      execute: async (call) => {
        const args = parseArgs(call);
        const pattern = String(args.pattern);
        if (pattern.startsWith("/") || pattern.includes("..")) throw new Error("非法 glob 模式");
        const regex = globToRegex(pattern);
        // 用模式的静态前缀缩小列举面（远程后端一次 list(prefix) 而非全量）
        const entries = await files.list(globStaticPrefix(pattern));
        const matched = entries.filter((e) => regex.test(e.path));
        matched.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
        return matched.map((e) => e.path).join("\n");
      },
    },
  };
}

function writeTool(files: ProjectFiles, approval: boolean): ToolDef {
  return {
    name: "Write",
    version: "1.0.0",
    preview: fileWritePreview,
    // mutation 工具：缺省免审批（沙盒内本地可逆）；approval=true 为强制征询变体
    //（AgentLoop 经 requestApproval 征询；后台非交互会话缺省即免审批）
    ...(approval ? { requireApproval: true } : {}),
    description:
      "将完整内容写入 workspace 目录内的文件，使用 workspace 相对路径。\n\n用法：\n- 若目标路径已有文件，本工具会整体覆盖。\n- 只用于新建或整体重写；小改动优先用 Edit。\n- 写入是原子的；缺失父目录自动创建。\n- 内容超过 512 KiB 会被拒绝；路径限定在 workspace 沙盒内。",
    parameters: {
      type: "object",
      properties: {
        file_path: { type: "string" },
        content: { type: "string" },
      },
      required: ["file_path", "content"],
      additionalProperties: false,
    },
    promptDetail: {
      // 工具优先级（system 恒可见）：改已有内容用 Edit；Write/Edit 只碰 workspace 文件，
      // 小说实体一律经 Novel* 工具操作（走 db + revision 乐观锁）
      policy:
        "改已有文件用 Edit，禁止 Write 覆盖做小改动；Write/Edit 只作用于 workspace 文件，小说实体一律经 Novel* 工具操作。",
      guidance: "",
    },
    handler: {
      execute: async (call) => {
        const args = parseArgs(call);
        const content = String(args.content);
        if (content.length > CONTENT_MAX) throw new Error("内容超过 512 KiB");
        await files.write(String(args.file_path), content);
        return `已写入 ${args.file_path}`;
      },
    },
  };
}

function editTool(files: ProjectFiles, approval: boolean): ToolDef {
  return {
    name: "Edit",
    version: "1.0.0",
    preview: fileEditPreview,
    // mutation 工具：缺省免审批（沙盒内本地可逆）；approval=true 为强制征询变体
    //（AgentLoop 经 requestApproval 征询；后台非交互会话缺省即免审批）
    ...(approval ? { requireApproval: true } : {}),
    description:
      "在 workspace 目录内的文件中做精确字符串替换。\n\n用法：\n- file_path 必须指向 workspace 内已有文件。\n- old_string 必须出现；未命中会报错。\n- replace_all=false（默认）只替换第一处。\n- 整体重写用 Write；编辑前建议先 Read。\n- 结果不得超过 512 KiB；路径限定在 workspace 沙盒内。",
    parameters: {
      type: "object",
      properties: {
        file_path: { type: "string" },
        old_string: { type: "string" },
        new_string: { type: "string" },
        replace_all: { type: "boolean" },
      },
      required: ["file_path", "old_string", "new_string"],
      additionalProperties: false,
    },
    promptDetail: {
      policy: "",
      guidance: "",
    },
    handler: {
      execute: async (call) => {
        const args = parseArgs(call);
        const relPath = String(args.file_path);
        const oldStr = String(args.old_string);
        const newStr = String(args.new_string);
        const content = await files.read(relPath);
        if (!content.includes(oldStr)) throw new Error("old_string 未在文件中命中");
        const replaceAll = args.replace_all === true;
        const result = replaceAll ? content.split(oldStr).join(newStr) : content.replace(oldStr, newStr);
        if (result.length > CONTENT_MAX) throw new Error("结果超过 512 KiB");
        await files.write(relPath, result);
        return `已替换${replaceAll ? "（全部）" : ""}`;
      },
    },
  };
}

/** glob 模式的静态前缀（首个通配符前的目录段，含尾 /）；用于缩小 list 面 */
function globStaticPrefix(pattern: string): string {
  const idx = pattern.search(/[*?]/);
  const head = idx === -1 ? pattern : pattern.slice(0, idx);
  const slash = head.lastIndexOf("/");
  return slash === -1 ? "" : head.slice(0, slash + 1);
}

/** 简单 glob → 正则（支持单星、双星与多级通配） */
function globToRegex(pattern: string): RegExp {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern.charAt(i);
    if (c === "*") {
      if (pattern.charAt(i + 1) === "*") {
        // **/ 匹配 0 个或多个目录层级
        if (pattern.charAt(i + 2) === "/") {
          re += "(?:[^/]+/)*";
          i += 2;
        } else {
          re += ".*";
          i++;
        }
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${re}$`);
}
