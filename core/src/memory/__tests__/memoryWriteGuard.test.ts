import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileTools } from "../../runtime/tool/definitions/files.js";
import { createMemoryWriteGuard } from "../createMemoryWriteGuard.js";
import type { ToolCall } from "../../runtime/provider/types.js";

function call(name: string, args: Record<string, unknown>): ToolCall {
  return { id: "c1", name, args: JSON.stringify(args) };
}

function tool(ws: string, name: string) {
  return createFileTools(ws, { guard: createMemoryWriteGuard(ws) }).find((t) => t.name === name)!;
}

const INDEX_OK = `version: 1
prose:
  - name: 战斗
    desc: 短兵相接的近身打斗与攻防节奏段落
    path: .novel/references/prose/combat.yaml
`;

const PROSE_OK = `kind: prose
name: 战斗
desc: 短兵相接的近身打斗与攻防节奏段落
updated: 2026-08-18
entries:
  - id: "001"
    source: paste
    added: 2026-08-18
    text: |
      三段轻功掠过檐角。
`;

function seedWorkspace(): string {
  const ws = mkdtempSync(join(tmpdir(), "memws-"));
  mkdirSync(join(ws, ".novel", "references", "prose"), { recursive: true });
  mkdirSync(join(ws, ".novel", "preset", "story"), { recursive: true });
  writeFileSync(join(ws, "MEMORY.yaml"), INDEX_OK, "utf8");
  writeFileSync(join(ws, ".novel", "references", "prose", "combat.yaml"), PROSE_OK, "utf8");
  return ws;
}

describe("memory 写守卫(files 工具接入)", () => {
  it("Write 命中 .novel/preset/** → 拒绝执行(硬闸)", async () => {
    const ws = seedWorkspace();
    const write = tool(ws, "Write");
    await expect(
      write.handler.execute(
        call("Write", { file_path: ".novel/preset/story/x.yaml", content: "kind: story" }),
      ),
    ).rejects.toThrow("预设只读");
  });

  it("Edit 命中 preset → 同样拒绝", async () => {
    const ws = seedWorkspace();
    writeFileSync(join(ws, ".novel", "preset", "story", "复仇.yaml"), "version: 1", "utf8");
    const edit = tool(ws, "Edit");
    await expect(
      edit.handler.execute(
        call("Edit", {
          file_path: ".novel/preset/story/复仇.yaml",
          old_string: "1",
          new_string: "2",
        }),
      ),
    ).rejects.toThrow("预设只读");
  });

  it("写合法 MEMORY.yaml → 结果干净(校验通过无警告)", async () => {
    const ws = seedWorkspace();
    const write = tool(ws, "Write");
    const out = await write.handler.execute(
      call("Write", { file_path: "MEMORY.yaml", content: INDEX_OK }),
    );
    expect(out).not.toContain("校验");
    expect(out).toContain("已写入");
  });

  it("写坏 MEMORY.yaml(条目 name 与文件不一致)→ 工具结果附校验错误", async () => {
    const ws = seedWorkspace();
    const write = tool(ws, "Write");
    const broken = INDEX_OK.replace("name: 战斗", "name: 鏖战"); // 目录 name ≠ 文件 name
    const out = await write.handler.execute(
      call("Write", { file_path: "MEMORY.yaml", content: broken }),
    );
    expect(out).toContain("动态编译校验未通过");
    expect(out).toContain("不一致");
  });

  it("写非 memory 路径 → 不触发校验(守卫静默)", async () => {
    const ws = seedWorkspace();
    const write = tool(ws, "Write");
    const out = await write.handler.execute(
      call("Write", { file_path: "notes/draft.md", content: "随便写" }),
    );
    expect(out).toBe("已写入 notes/draft.md");
  });
});
