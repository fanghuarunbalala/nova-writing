/**
 * runtime.files 工具组（Read / Glob / Write / Edit）——从旧 main 分支迁移。
 * 参数与行为对齐 CCB（file_path workspace 相对、沙盒限定、512KiB 上限）。
 */
import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import { join, resolve, relative, sep, dirname } from "node:path";
import type { ToolDef } from "../ToolDef.js";
import { fileReadPreview, fileGlobPreview, fileWritePreview, fileEditPreview } from "../previews.js";
import type { ToolCall } from "../../provider/types.js";

const PATH_MAX = 1024;
const CONTENT_MAX = 512 * 1024;

/** 沙盒路径解析：workspace 相对路径 → 绝对路径，校验不逃逸沙盒 */
function resolveInWorkspace(workspace: string, filePath: string): string {
  const abs = resolve(workspace, filePath);
  const rel = relative(workspace, abs);
  if (rel.startsWith("..") || rel.split(sep)[0] === ".." || abs === resolve(workspace)) {
    if (filePath !== "." && filePath !== "") {
      throw new Error(`路径逃逸 workspace 沙盒: ${filePath}`);
    }
  }
  if (filePath.includes("\0")) throw new Error("路径含非法字符");
  if (filePath.length > PATH_MAX) throw new Error("路径超长");
  return abs;
}

/** 解析 tool args JSON，校验必填 file_path */
function parseArgs(call: ToolCall): Record<string, unknown> {
  try {
    return JSON.parse(call.args) as Record<string, unknown>;
  } catch {
    throw new Error(`无效的 JSON 参数: ${call.args}`);
  }
}

/**
 * 创建 files 四件套 ToolDef（handler 闭包 workspace 做沙盒限定）
 * @param workspace 工作区绝对路径
 * @returns Read/Glob/Write/Edit 四个工具定义
 */
export function createFileTools(workspace: string): ToolDef[] {
  return [readTool(workspace), globTool(workspace), writeTool(workspace), editTool(workspace)];
}

function readTool(workspace: string): ToolDef {
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
      policy: "Use Read to review files inside the workspace (e.g., the current design draft).",
      guidance: "file_path is required and must be workspace-relative; pass offset/limit to read a slice of a long file. Read-only; confined to the workspace sandbox.",
    },
    handler: {
      execute: async (call) => {
        const args = parseArgs(call);
        const abs = resolveInWorkspace(workspace, String(args.file_path));
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
      policy: "Use Glob to discover workspace files before reading or editing them.",
      guidance: "Patterns are resolved against the workspace root; absolute patterns and parent traversal are rejected. Read-only.",
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

function writeTool(workspace: string): ToolDef {
  return {
    name: "Write",
    version: "1.0.0",
    preview: fileWritePreview,
    // mutation 工具：执行前需用户审批（AgentLoop 经 requestApproval 征询）
    requireApproval: true,
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
      policy: "Use Write to replace a whole workspace file (e.g., the design draft) with new content.",
      guidance: "file_path must be a workspace-relative path; content is written atomically. Writes outside the workspace sandbox are rejected.",
    },
    handler: {
      execute: async (call) => {
        const args = parseArgs(call);
        const content = String(args.content);
        if (content.length > CONTENT_MAX) throw new Error("内容超过 512 KiB");
        const abs = resolveInWorkspace(workspace, String(args.file_path));
        await mkdir(dirname(abs), { recursive: true });
        await writeFile(abs, content, "utf8");
        return `已写入 ${args.file_path}`;
      },
    },
  };
}

function editTool(workspace: string): ToolDef {
  return {
    name: "Edit",
    version: "1.0.0",
    preview: fileEditPreview,
    // mutation 工具：执行前需用户审批（AgentLoop 经 requestApproval 征询）
    requireApproval: true,
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
      policy: "Use Edit for small incremental changes to a workspace file (e.g., the design draft).",
      guidance: "old_string must appear in the file; provide enough context to match exactly once when replace_all=false. Edits outside the workspace sandbox are rejected.",
    },
    handler: {
      execute: async (call) => {
        const args = parseArgs(call);
        const abs = resolveInWorkspace(workspace, String(args.file_path));
        const oldStr = String(args.old_string);
        const newStr = String(args.new_string);
        const content = await readFile(abs, "utf8");
        if (!content.includes(oldStr)) throw new Error("old_string 未在文件中命中");
        const replaceAll = args.replace_all === true;
        const result = replaceAll ? content.split(oldStr).join(newStr) : content.replace(oldStr, newStr);
        if (result.length > CONTENT_MAX) throw new Error("结果超过 512 KiB");
        await writeFile(abs, result, "utf8");
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
