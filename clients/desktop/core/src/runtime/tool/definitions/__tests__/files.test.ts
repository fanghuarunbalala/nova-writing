import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileTools } from "../files.js";
import type { ToolCall } from "../../../provider/types.js";

function call(name: string, args: Record<string, unknown>): ToolCall {
  return { id: "c1", name, args: JSON.stringify(args) };
}

function tool(workspace: string, name: string) {
  return createFileTools(workspace).find((t) => t.name === name)!;
}

describe("createFileTools（files 四件套）", () => {
  it("Write + Read 往返", async () => {
    const ws = mkdtempSync(join(tmpdir(), "ws-"));
    const write = tool(ws, "Write");
    const read = tool(ws, "Read");
    await write.handler.execute(call("Write", { file_path: "draft.md", content: "第一行\n第二行" }));
    const out = await read.handler.execute(call("Read", { file_path: "draft.md" }));
    expect(out).toContain("1\t第一行");
    expect(out).toContain("2\t第二行");
  });

  it("Edit 精确替换", async () => {
    const ws = mkdtempSync(join(tmpdir(), "ws-"));
    const write = tool(ws, "Write");
    const edit = tool(ws, "Edit");
    await write.handler.execute(call("Write", { file_path: "d.md", content: "hello world" }));
    await edit.handler.execute(call("Edit", { file_path: "d.md", old_string: "world", new_string: "novel" }));
    expect(readFileSync(join(ws, "d.md"), "utf8")).toBe("hello novel");
  });

  it("Glob 匹配文件", async () => {
    const ws = mkdtempSync(join(tmpdir(), "ws-"));
    const write = tool(ws, "Write");
    const glob = tool(ws, "Glob");
    await write.handler.execute(call("Write", { file_path: "a.md", content: "x" }));
    await write.handler.execute(call("Write", { file_path: "b.txt", content: "y" }));
    const out = await glob.handler.execute(call("Glob", { pattern: "**/*.md" }));
    expect(out).toContain("a.md");
    expect(out).not.toContain("b.txt");
  });

  it("沙盒逃逸被拒绝", async () => {
    const ws = mkdtempSync(join(tmpdir(), "ws-"));
    const read = tool(ws, "Read");
    await expect(read.handler.execute(call("Read", { file_path: "../secret" }))).rejects.toThrow("逃逸");
  });
});
