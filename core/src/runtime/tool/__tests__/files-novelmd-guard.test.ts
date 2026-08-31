import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createFileTools } from "../definitions/files.js";
import type { ToolCall } from "../../provider/types.js";

let workspace: string;
let globalPath: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "files-guard-"));
  globalPath = join(tmpdir(), `global-novel-${Date.now()}-${Math.random().toString(36).slice(2)}.md`);
});

function call(name: string, args: Record<string, unknown>): ToolCall {
  return { id: "tc1", name, args: JSON.stringify(args) };
}

describe("NOVEL.md 文件守卫（PRD memory-两层记忆 D3）", () => {
  it("requiresApprovalFor：项目层 NOVEL.md（任意大小写/./前缀归一）命中，普通文件不命中", () => {
    const [write, edit] = createFileTools(workspace, { guardedFiles: ["NOVEL.md"] }).filter(
      (t) => t.name === "Write" || t.name === "Edit",
    );
    expect(write?.requiresApprovalFor?.(call("Write", { file_path: "NOVEL.md", content: "x" }))).toBe(true);
    expect(write?.requiresApprovalFor?.(call("Write", { file_path: "novel.md", content: "x" }))).toBe(true);
    expect(write?.requiresApprovalFor?.(call("Write", { file_path: "./NOVEL.md", content: "x" }))).toBe(true);
    expect(write?.requiresApprovalFor?.(call("Write", { file_path: "notes/a.md", content: "x" }))).toBe(false);
    expect(edit?.requiresApprovalFor?.(call("Edit", { file_path: "NOVEL.md", old_string: "a", new_string: "b" }))).toBe(true);
    // 参数损坏按不守卫（execute 层报参数错）
    expect(write?.requiresApprovalFor?.(call("Write", { content: "x" }))).toBe(false);
  });

  it("全局层绝对路径：守卫命中 + 沙盒例外可写可读；其他绝对路径仍拒绝", async () => {
    const tools = createFileTools(workspace, {
      guardedFiles: ["NOVEL.md"],
      extraFiles: [globalPath],
    });
    const write = tools.find((t) => t.name === "Write");
    const read = tools.find((t) => t.name === "Read");
    expect(write?.requiresApprovalFor?.(call("Write", { file_path: globalPath, content: "x" }))).toBe(true);
    await write!.handler.execute(call("Write", { file_path: globalPath, content: "全局层内容" }));
    const content = await read!.handler.execute(call("Read", { file_path: globalPath }));
    expect(content).toContain("全局层内容");
    await expect(
      write!.handler.execute(call("Write", { file_path: resolve(workspace, "..", "evil.md"), content: "x" })),
    ).rejects.toThrow();
  });

  it("未装配 extraFiles：绝对路径一律拒绝（默认无全局层）", async () => {
    const [write] = createFileTools(workspace).filter((t) => t.name === "Write");
    await expect(
      write!.handler.execute(call("Write", { file_path: globalPath, content: "x" })),
    ).rejects.toThrow("绝对路径不在可达范围");
  });

  it("workspace 内正常读写不受守卫影响（Read/Glob 照常）", async () => {
    const tools = createFileTools(workspace, { guardedFiles: ["NOVEL.md"] });
    const write = tools.find((t) => t.name === "Write");
    const read = tools.find((t) => t.name === "Read");
    await mkdir(join(workspace, "sub"), { recursive: true });
    await writeFile(join(workspace, "NOVEL.md"), "现有约束", "utf8");
    await write!.handler.execute(call("Write", { file_path: "sub/draft.md", content: "草稿" }));
    const content = await read!.handler.execute(call("Read", { file_path: "sub/draft.md" }));
    expect(content).toContain("草稿");
  });
});
