import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileTools } from "../definitions/files.js";
import type { ToolCall } from "../../provider/types.js";

function callOf(name: string, args: Record<string, unknown>): ToolCall {
  return { id: "t1", name, args: JSON.stringify(args) };
}

describe("files 工具沙盒（.novel/cases 可达性回归，PRD compose-案例引导）", () => {
  it("Read 可读 workspace 内 .novel/cases 下文件（隐藏目录不过滤）", async () => {
    const ws = await mkdtemp(join(tmpdir(), "files-sb-"));
    await mkdir(join(ws, ".novel", "cases"), { recursive: true });
    await writeFile(join(ws, ".novel", "cases", "a.md"), "案例内容", "utf8");
    const read = createFileTools(ws).find((t) => t.name === "Read")!;
    const out = await read.handler.execute(callOf("Read", { file_path: ".novel/cases/a.md" }));
    expect(out).toContain("案例内容");
  });

  it("Glob 可发现 .novel/cases 下文件（返回 workspace 相对路径）", async () => {
    const ws = await mkdtemp(join(tmpdir(), "files-sb-"));
    await mkdir(join(ws, ".novel", "cases"), { recursive: true });
    await writeFile(join(ws, ".novel", "cases", "a.md"), "x", "utf8");
    const glob = createFileTools(ws).find((t) => t.name === "Glob")!;
    const out = await glob.handler.execute(callOf("Glob", { pattern: ".novel/cases/*.md" }));
    expect(out).toContain(".novel/cases/a.md");
  });

  it("路径逃逸仍被拒绝（.. 穿越）", async () => {
    const ws = await mkdtemp(join(tmpdir(), "files-sb-"));
    const read = createFileTools(ws).find((t) => t.name === "Read")!;
    await expect(
      read.handler.execute(callOf("Read", { file_path: "../outside.md" })),
    ).rejects.toThrow();
  });
});
