import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readNovelGlobalConstraintsSafe,
  NOVEL_GLOBAL_CONSTRAINTS_MAX_BYTES,
} from "../workspace/readNovelGlobalConstraints.js";

describe("readNovelGlobalConstraintsSafe（node 层）", () => {
  it("文件存在 → 返回 UTF-8 内容", async () => {
    const dir = await mkdtemp(join(tmpdir(), "constraints-"));
    await writeFile(join(dir, "NOVEL.md"), "# 世界观\n- 基调热血", "utf8");
    expect(await readNovelGlobalConstraintsSafe(dir)).toBe("# 世界观\n- 基调热血");
  });

  it("文件缺失 → undefined（静默不抛）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "constraints-"));
    expect(await readNovelGlobalConstraintsSafe(dir)).toBeUndefined();
  });

  it("非文件（目录）→ undefined", async () => {
    const dir = await mkdtemp(join(tmpdir(), "constraints-"));
    await mkdir(join(dir, "NOVEL.md"));
    expect(await readNovelGlobalConstraintsSafe(dir)).toBeUndefined();
  });

  it("超 256KiB → undefined（不读入）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "constraints-"));
    await writeFile(join(dir, "NOVEL.md"), "x".repeat(NOVEL_GLOBAL_CONSTRAINTS_MAX_BYTES + 1), "utf8");
    expect(await readNovelGlobalConstraintsSafe(dir)).toBeUndefined();
  });

  it("workdir 无效路径 → undefined（静默不抛）", async () => {
    expect(
      await readNovelGlobalConstraintsSafe(join(tmpdir(), "no-such-dir-xyz")),
    ).toBeUndefined();
  });
});
