/**
 * FileToolService 聚焦冒烟：workspace 沙盒（相对路径）+ Read/Glob/Write/Edit 纯逻辑。
 * Focused smoke for FileToolService: workspace sandbox (relative paths) plus tool logic.
 *
 * 语义（2026-08 修正）：沙盒根 = workspace 根；file ops 一律用 workspace 相对路径；
 * 绝对路径、../ 逃逸、symlink 逃逸均报 pathForbidden；Write/Edit 可写沙盒内任意路径。
 */
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  FILE_TOOL_ERROR_CODE,
  FileToolError,
  FileToolService,
} from "../dist/tools/files/ToolService.js";

const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "file-tools-smoke-"));
const design = path.join(workspaceRoot, ".novel", "design");
await fs.mkdir(design, { recursive: true });
const designFile = path.join(design, "chapter-1.md");
await fs.writeFile(designFile, "第一行\n第二行\n第三行\n", "utf8");
await fs.writeFile(path.join(design, "chapter-2.md"), "other\n", "utf8");
await fs.mkdir(path.join(design, "sub"), { recursive: true });
await fs.writeFile(path.join(design, "sub", "notes.md"), "note\n", "utf8");
await fs.writeFile(path.join(workspaceRoot, "draft.txt"), "txt\n", "utf8");
await fs.writeFile(path.join(workspaceRoot, "root-notes.md"), "root\n", "utf8");

// 固定 mtime 以便验证 Glob 降序（相对路径）。
// Pin distinct mtimes so Glob descending order (relative paths) is deterministic.
const now = Date.now();
await fs.utimes(designFile, new Date(now - 4_000), new Date(now - 4_000));
await fs.utimes(
  path.join(design, "chapter-2.md"),
  new Date(now - 3_000),
  new Date(now - 3_000),
);
await fs.utimes(
  path.join(design, "sub", "notes.md"),
  new Date(now - 2_000),
  new Date(now - 2_000),
);
await fs.utimes(
  path.join(workspaceRoot, "root-notes.md"),
  new Date(now - 1_000),
  new Date(now - 1_000),
);

const service = new FileToolService({ sandboxRoot: workspaceRoot });
const tiny = new FileToolService({ sandboxRoot: workspaceRoot, maxFileBytes: 8 });

// Read：用 workspace 相对路径；details.file_path 返回相对路径。
const full = await service.read(".novel/design/chapter-1.md");
assert.equal(full.totalLines, 4);
assert.equal(full.truncated, false);
assert.equal(full.content, "第一行\n第二行\n第三行\n");
assert.equal(full.file_path, ".novel/design/chapter-1.md");

const window = await service.read(".novel/design/chapter-1.md", 1, 2);
assert.equal(window.content, "第二行\n第三行");
assert.equal(window.truncated, true);

await assert.rejects(
  service.read(".novel/design/missing.md"),
  (error) => error instanceof FileToolError && error.code === FILE_TOOL_ERROR_CODE.notFound,
);
await assert.rejects(
  tiny.read(".novel/design/chapter-1.md"),
  (error) => error instanceof FileToolError && error.code === FILE_TOOL_ERROR_CODE.tooLarge,
);

// 路径沙盒：绝对路径一律拒绝（即使落在沙盒内）；../ 逃逸；symlink 逃逸。
await assert.rejects(
  service.read(designFile),
  (error) => error instanceof FileToolError && error.code === FILE_TOOL_ERROR_CODE.pathForbidden,
);
await assert.rejects(
  service.read(path.join(design, "chapter-2.md")),
  (error) => error instanceof FileToolError && error.code === FILE_TOOL_ERROR_CODE.pathForbidden,
);
await assert.rejects(
  service.read("../outside.md"),
  (error) => error instanceof FileToolError && error.code === FILE_TOOL_ERROR_CODE.pathForbidden,
);
const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "file-tools-outside-"));
const outside = path.join(outsideDir, "outside.md");
await fs.writeFile(outside, "secret\n", "utf8");
const link = path.join(design, "escape.md");
try {
  await fs.symlink(outside, link);
} catch (error) {
  // Windows 无开发者模式时无法创建 symlink（EPERM）；跳过 symlink 逃逸断言。
  // Skip the symlink-escape assertion when the platform cannot create symlinks.
  console.log(`  (skipping symlink escape: ${error.code})`);
}
if (await fs.access(link).then(() => true, () => false)) {
  await assert.rejects(
    service.read(".novel/design/escape.md"),
    (error) => error instanceof FileToolError && error.code === FILE_TOOL_ERROR_CODE.pathForbidden,
  );
}

// Glob：workspace 相对路径返回 + mtime 降序 + 不安全模式。
const rootMd = await service.glob("*.md");
assert.deepEqual(rootMd.matches, ["root-notes.md"]);

const allMd = await service.glob("**/*.md");
assert.deepEqual(allMd.matches, [
  "root-notes.md",
  ".novel/design/sub/notes.md",
  ".novel/design/chapter-2.md",
  ".novel/design/chapter-1.md",
]);
await assert.rejects(
  service.glob("../*.md"),
  (error) => error instanceof FileToolError && error.code === FILE_TOOL_ERROR_CODE.pathForbidden,
);
await assert.rejects(
  service.glob("/etc/*"),
  (error) => error instanceof FileToolError && error.code === FILE_TOOL_ERROR_CODE.pathForbidden,
);

// Write：沙盒内任意相对路径可写（含新目录）；绝对路径 / ../ 拒绝；内容落盘。
await service.write(".novel/design/chapter-1.md", "新正文\n");
assert.equal(await fs.readFile(designFile, "utf8"), "新正文\n");
await service.write("draft.txt", "updated\n");
assert.equal(await fs.readFile(path.join(workspaceRoot, "draft.txt"), "utf8"), "updated\n");
await service.write("scratch/notes.md", "hello\n");
assert.equal(await fs.readFile(path.join(workspaceRoot, "scratch", "notes.md"), "utf8"), "hello\n");
await assert.rejects(
  service.write(path.join(design, "other.md"), "x"),
  (error) => error instanceof FileToolError && error.code === FILE_TOOL_ERROR_CODE.pathForbidden,
);
await assert.rejects(
  service.write("../evil.md", "x"),
  (error) => error instanceof FileToolError && error.code === FILE_TOOL_ERROR_CODE.pathForbidden,
);

// Edit：替换第一个 / replace_all / 未命中（相对路径）。
await service.write(".novel/design/chapter-1.md", "a b a c\n");
await service.edit(".novel/design/chapter-1.md", "a", "X");
assert.equal(await fs.readFile(designFile, "utf8"), "X b a c\n");
await service.edit(".novel/design/chapter-1.md", "a", "Y", true);
assert.equal(await fs.readFile(designFile, "utf8"), "X b Y c\n");
await assert.rejects(
  service.edit(".novel/design/chapter-1.md", "不存在的串", "z"),
  (error) => error instanceof FileToolError && error.code === FILE_TOOL_ERROR_CODE.editMissing,
);

await fs.rm(workspaceRoot, { recursive: true, force: true });
await fs.rm(outsideDir, { recursive: true, force: true });
console.log("file tools service smoke passed");
