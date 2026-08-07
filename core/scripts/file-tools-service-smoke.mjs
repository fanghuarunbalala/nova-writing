/**
 * FileToolService 聚焦冒烟：路径沙箱 + Read/Glob/Write/Edit 纯逻辑。
 * Focused smoke for FileToolService: path sandbox plus Read/Glob/Write/Edit logic.
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

const root = await fs.mkdtemp(path.join(os.tmpdir(), "file-tools-smoke-"));
const design = path.join(root, "design");
await fs.mkdir(design, { recursive: true });
const designFile = path.join(design, "chapter-1.md");
await fs.writeFile(designFile, "第一行\n第二行\n第三行\n", "utf8");
await fs.writeFile(path.join(design, "chapter-2.md"), "other\n", "utf8");
await fs.mkdir(path.join(design, "sub"), { recursive: true });
await fs.writeFile(path.join(design, "sub", "notes.md"), "note\n", "utf8");
await fs.writeFile(path.join(design, "draft.txt"), "txt\n", "utf8");

// 固定 mtime 以便验证 Glob 降序。
// Pin distinct mtimes so Glob descending order is deterministic.
const now = Date.now();
await fs.utimes(designFile, new Date(now - 3_000), new Date(now - 3_000));
await fs.utimes(
  path.join(design, "chapter-2.md"),
  new Date(now - 2_000),
  new Date(now - 2_000),
);
await fs.utimes(
  path.join(design, "sub", "notes.md"),
  new Date(now - 1_000),
  new Date(now - 1_000),
);

const service = new FileToolService({ designRoot: design, designFilePath: designFile });
const tiny = new FileToolService({
  designRoot: design,
  designFilePath: designFile,
  maxFileBytes: 8,
});

// Read：全文 / 行范围 / 截断 / 未找到 / 超限
const full = await service.read(designFile);
assert.equal(full.totalLines, 4);
assert.equal(full.truncated, false);
assert.equal(full.content, "第一行\n第二行\n第三行\n");

const window = await service.read(designFile, 1, 2);
assert.equal(window.content, "第二行\n第三行");
assert.equal(window.truncated, true);

await assert.rejects(
  service.read(path.join(design, "missing.md")),
  (error) => error instanceof FileToolError && error.code === FILE_TOOL_ERROR_CODE.notFound,
);
await assert.rejects(
  tiny.read(designFile),
  (error) => error instanceof FileToolError && error.code === FILE_TOOL_ERROR_CODE.tooLarge,
);

// 路径沙箱：../ 逃逸 / 绝对路径越界 / symlink 逃逸
await assert.rejects(
  service.read(path.join(design, "..", "outside.md")),
  (error) => error instanceof FileToolError && error.code === FILE_TOOL_ERROR_CODE.pathForbidden,
);
const outside = path.join(root, "outside.md");
await fs.writeFile(outside, "secret\n", "utf8");
const link = path.join(design, "escape.md");
await fs.symlink(outside, link);
await assert.rejects(
  service.read(link),
  (error) => error instanceof FileToolError && error.code === FILE_TOOL_ERROR_CODE.pathForbidden,
);

// Glob：模式匹配 + 根目录 **/* + mtime 降序 + 不安全模式
const rootMd = await service.glob("*.md");
assert.deepEqual(
  [...rootMd.matches].sort(),
  [designFile, path.join(design, "chapter-2.md")].sort(),
);

const allMd = await service.glob("**/*.md");
assert.deepEqual(
  allMd.matches,
  [path.join(design, "sub", "notes.md"), path.join(design, "chapter-2.md"), designFile],
);
await assert.rejects(
  service.glob("../*.md"),
  (error) => error instanceof FileToolError && error.code === FILE_TOOL_ERROR_CODE.pathForbidden,
);
await assert.rejects(
  service.glob("/etc/*"),
  (error) => error instanceof FileToolError && error.code === FILE_TOOL_ERROR_CODE.pathForbidden,
);

// Write：仅 design 文件；其他路径拒绝；内容落盘
await service.write(designFile, "新正文\n");
assert.equal(await fs.readFile(designFile, "utf8"), "新正文\n");
await assert.rejects(
  service.write(path.join(design, "other.md"), "x"),
  (error) => error instanceof FileToolError && error.code === FILE_TOOL_ERROR_CODE.pathForbidden,
);

// Edit：替换第一个 / replace_all / 未命中
await service.write(designFile, "a b a c\n", "utf8");
await service.edit(designFile, "a", "X");
assert.equal(await fs.readFile(designFile, "utf8"), "X b a c\n");
await service.edit(designFile, "a", "Y", true);
assert.equal(await fs.readFile(designFile, "utf8"), "X b Y c\n");
await assert.rejects(
  service.edit(designFile, "不存在的串", "z"),
  (error) => error instanceof FileToolError && error.code === FILE_TOOL_ERROR_CODE.editMissing,
);

await fs.rm(root, { recursive: true, force: true });
console.log("file tools service smoke passed");
