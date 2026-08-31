/**
 * runtime.files 工具组（Read / Glob / Write / Edit）——从旧 main 分支迁移。
 * 参数与行为对齐 CCB（file_path workspace 相对、沙盒限定、512KiB 上限）。
 */
import { readFile, writeFile, mkdir, readdir, stat, rename, rm } from "node:fs/promises";
import { realpath } from "node:fs/promises";
import { join, resolve, relative, sep, dirname, isAbsolute } from "node:path";
import type { ToolDef } from "../ToolDef.js";
import { fileReadPreview, fileGlobPreview, fileWritePreview, fileEditPreview } from "../previews.js";
import type { ToolCall } from "../../provider/types.js";
import { ToolError } from "../errors.js";

const PATH_MAX = 1024;
const CONTENT_MAX = 512 * 1024;

/** 沙盒路径解析：workspace 相对路径 → 绝对路径，校验不逃逸沙盒（含 symlink 防护）。
 * extraFiles = 沙盒例外绝对路径（PRD memory-两层记忆 M1：全局层 NOVEL.md 在用户
 * 数据目录、workspace 之外）——绝对路径精确匹配例外清单即可达（大小写不敏感）。 */
async function resolveInWorkspace(
  workspace: string,
  filePath: string,
  extraFiles: readonly string[] = [],
): Promise<string> {
  const abs = resolve(workspace, filePath);
  if (isAbsolute(filePath)) {
    // 绝对路径仅当精确命中例外清单（全局层 NOVEL.md）才可达，其余一律拒绝
    const hit = extraFiles.some((p) => p.toLowerCase() === abs.toLowerCase());
    if (!hit) throw new Error(`绝对路径不在可达范围（仅 workspace 相对路径或受审例外文件）: ${filePath}`);
    return abs;
  }
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

/** 归一化 workspace 相对路径（分隔符统一 /、消除 ./；大小写不敏感比较用小写） */
function normalizeRel(p: string): string {
  return p.split(/[\\/]/).filter((seg) => seg !== "." && seg.length > 0).join("/").toLowerCase();
}

/**
 * 创建 files 四件套 ToolDef（handler 闭包 workspace 做沙盒限定）
 * @param workspace 工作区绝对路径
 * @param options approval=false 时 Write/Edit 免审批（后台非交互会话用，如
 *   BookAnalyst 的 analyst.files 组——无人应答审批，requireApproval 会永久挂起）；
 *   guardedFiles = 强制审批的 workspace 相对路径（如项目层 NOVEL.md，PRD
 *   memory-两层记忆 D3：模型对静态声明的修改必须过作者审批，不受组级免审批影响）；
 *   extraFiles = 沙盒例外绝对路径（如全局层 NOVEL.md，用户数据目录——仅精确匹配
 *   可写，同样走 guardedFiles 之外的独立审批判定）
 * @returns Read/Glob/Write/Edit 四个工具定义
 */
export function createFileTools(
  workspace: string,
  options?: {
    requireApproval?: boolean;
    /** 强制审批的 workspace 相对路径（大小写不敏感精确匹配；如 ["NOVEL.md"]） */
    guardedFiles?: readonly string[];
    /** 沙盒例外绝对路径（可读可写；如全局层 NOVEL.md。亦强制审批） */
    extraFiles?: readonly string[];
  },
): ToolDef[] {
  // 文件写默认免审批：workspace 沙盒内、本地可逆，对齐主代理「本地可逆动作可直接做」
  // （谨慎行动段）；显式 requireApproval: true 才强制征询（预留未来高风险文件会话）。
  const approval = options?.requireApproval === true;
  const guarded = new Set((options?.guardedFiles ?? []).map(normalizeRel));
  const extra = (options?.extraFiles ?? []).map((p) => resolve(p));
  /** 守卫判定：file_path 命中 guardedFiles（相对）或 extraFiles（绝对，大小写不敏感） */
  const isGuarded = (filePath: string): boolean => {
    const raw = filePath.trim();
    if (guarded.has(normalizeRel(raw))) return true;
    const abs = resolve(raw);
    if (isAbsolute(raw)) {
      return extra.some((p) => p.toLowerCase() === abs.toLowerCase());
    }
    // 相对路径经 workspace 解析后与例外绝对路径比对（如 a/../NOVEL.md 归一后命中）
    const inWs = resolve(workspace, raw);
    return extra.some((p) => p.toLowerCase() === inWs.toLowerCase());
  };
  /** 按调用审批判定（Write/Edit 专用；args 解析失败按不守卫，交给 execute 报参数错） */
  const approvalGuard = (call: ToolCall): boolean => {
    try {
      const args = JSON.parse(call.args) as Record<string, unknown>;
      return typeof args.file_path === "string" && isGuarded(args.file_path);
    } catch {
      return false;
    }
  };
  return [
    readTool(workspace, extra),
    globTool(workspace),
    writeTool(workspace, approval, approvalGuard, extra),
    editTool(workspace, approval, approvalGuard, extra),
  ];
}

function readTool(workspace: string, extraFiles: readonly string[] = []): ToolDef {
  return {
    name: "Read",
    version: "1.0.0",
    preview: fileReadPreview,
    description:
      "从 workspace 目录读取文件，使用 workspace 相对路径。\n\n用法：\n- file_path 必须是 workspace 相对路径（例外：全局层 NOVEL.md 的绝对路径可读）。\n- 结果按 cat -n 格式返回，行号从 1 开始。\n- 默认读取整个文件；可传 offset 行偏移和 limit 行数读取指定区间。\n- 超过 512 KiB 会报错，请分段读取。\n- 只读文件，不读目录；路径限定在 workspace 沙盒内。",
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
        const abs = await resolveInWorkspace(workspace, String(args.file_path), extraFiles);
        const content = await readFile(abs, "utf8");
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

function globTool(workspace: string): ToolDef {
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
        const matches: string[] = [];
        await walk(workspace, workspace, regex, matches);
        return matches.join("\n");
      },
    },
  };
}

function writeTool(
  workspace: string,
  approval: boolean,
  approvalGuard: (call: ToolCall) => boolean,
  extraFiles: readonly string[] = [],
): ToolDef {
  return {
    name: "Write",
    version: "1.0.0",
    preview: fileWritePreview,
    // mutation 工具：缺省免审批（沙盒内本地可逆）；approval=true 为强制征询变体
    //（AgentLoop 经 requestApproval 征询；后台非交互会话缺省即免审批）。
    // requiresApprovalFor：file_path 命中 NOVEL.md 等静态声明文件时按调用强制征询
    //（PRD memory-两层记忆 D3——模型改静态层必经作者审批，不受组级免审批影响）
    ...(approval ? { requireApproval: true } : {}),
    requiresApprovalFor: approvalGuard,
    description:
      "将完整内容写入 workspace 目录内的文件，使用 workspace 相对路径。\n\n用法：\n- 若目标路径已有文件，本工具会整体覆盖。\n- 只用于新建或整体重写；小改动优先用 Edit。\n- 写入是原子的；缺失父目录自动创建。\n- 内容超过 512 KiB 会被拒绝；路径限定在 workspace 沙盒内（例外：全局层 NOVEL.md 绝对路径）。\n- 修改 NOVEL.md（项目层或全局层）需要作者审批。",
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
      // 小说实体一律经 Novel* 工具操作（走 db + revision 乐观锁）；NOVEL.md 修改必经审批
      policy:
        "改已有文件用 Edit，禁止 Write 覆盖做小改动；Write/Edit 只作用于 workspace 文件，小说实体一律经 Novel* 工具操作；修改 NOVEL.md（静态声明层）必须经作者审批。",
      guidance: "",
    },
    handler: {
      execute: async (call) => {
        const args = parseArgs(call);
        const content = String(args.content);
        if (content.length > CONTENT_MAX) throw new Error("内容超过 512 KiB");
        const abs = await resolveInWorkspace(workspace, String(args.file_path), extraFiles);
        await mkdir(dirname(abs), { recursive: true });
        await writeFileAtomic(abs, content);
        return `已写入 ${args.file_path}`;
      },
    },
  };
}

function editTool(
  workspace: string,
  approval: boolean,
  approvalGuard: (call: ToolCall) => boolean,
  extraFiles: readonly string[] = [],
): ToolDef {
  return {
    name: "Edit",
    version: "1.0.0",
    preview: fileEditPreview,
    // mutation 工具：缺省免审批（沙盒内本地可逆）；approval=true 为强制征询变体
    //（AgentLoop 经 requestApproval 征询；后台非交互会话缺省即免审批）
    // requiresApprovalFor：同 Write——file_path 命中 NOVEL.md 等静态声明文件时强制征询
    ...(approval ? { requireApproval: true } : {}),
    requiresApprovalFor: approvalGuard,
    description:
      "在 workspace 目录内的文件中做精确字符串替换。\n\n用法：\n- file_path 必须指向 workspace 内已有文件（例外：全局层 NOVEL.md 绝对路径）。\n- old_string 必须出现；未命中会报错。\n- replace_all=false（默认）只替换第一处。\n- 整体重写用 Write；编辑前建议先 Read。\n- 结果不得超过 512 KiB；路径限定在 workspace 沙盒内。\n- 修改 NOVEL.md（项目层或全局层）需要作者审批。",
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
        const abs = await resolveInWorkspace(workspace, String(args.file_path), extraFiles);
        const oldStr = String(args.old_string);
        const newStr = String(args.new_string);
        const content = await readFile(abs, "utf8");
        if (!content.includes(oldStr)) throw new Error("old_string 未在文件中命中");
        const replaceAll = args.replace_all === true;
        const result = replaceAll ? content.split(oldStr).join(newStr) : content.replace(oldStr, newStr);
        if (result.length > CONTENT_MAX) throw new Error("结果超过 512 KiB");
        await writeFileAtomic(abs, result);
        return `已替换${replaceAll ? "（全部）" : ""}`;
      },
    },
  };
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

/** 递归遍历匹配 glob */
async function walk(root: string, dir: string, regex: RegExp, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const abs = join(dir, e.name);
    const rel = relative(root, abs).split(sep).join("/");
    if (e.isDirectory()) {
      await walk(root, abs, regex, out);
    } else if (regex.test(rel)) {
      out.push(rel);
    }
  }
}
