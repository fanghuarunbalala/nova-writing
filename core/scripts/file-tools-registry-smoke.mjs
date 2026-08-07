/**
 * runtime.files 注册表冒烟：工具注册、descriptor、handler 接线。
 * Registry smoke for runtime.files: registration, descriptors, handler wiring.
 */
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { noopToolProgressSink } from "../dist/tooling/protocol/ToolProgress.js";
import {
  FILE_TOOL_ERROR_CODE,
  FileToolService,
  RUNTIME_FILES_TOOL_GROUP_MANIFEST,
  createFileToolRegistry,
} from "../dist/tools/files/index.js";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "file-registry-smoke-"));
const design = path.join(root, "design");
await fs.mkdir(design, { recursive: true });
const designFile = path.join(design, "chapter-1.md");
await fs.writeFile(designFile, "第一行\n第二行\n", "utf8");

const service = new FileToolService({ designRoot: design, designFilePath: designFile });
const registry = createFileToolRegistry({ service });

assert.equal(registry.size, 4);
assert.deepEqual(
  registry.list().map((tool) => tool.descriptor.name),
  ["Edit", "Glob", "Read", "Write"],
);
for (const name of ["Read", "Glob", "Write", "Edit"]) {
  assert.equal(registry.require(name).descriptor.version, "1.0.0");
  assert.ok(registry.require(name).descriptor.parameters);
}
assert.deepEqual(RUNTIME_FILES_TOOL_GROUP_MANIFEST.tools, [
  "Read",
  "Glob",
  "Write",
  "Edit",
]);

const context = {
  conversationId: "file-registry",
  runId: "run-1",
  toolCallId: "call-1",
  signal: new AbortController().signal,
};

// Read handler：正常读取 + 越界路径映射为 ToolError（permission 类）。
const read = registry.require("Read");
const result = await read.handler.execute(
  context,
  { file_path: designFile },
  noopToolProgressSink,
);
assert.equal(result.details.totalLines, 3);
assert.match(result.content[0].text, /^1\t第一行/);

await assert.rejects(
  read.handler.execute(
    context,
    { file_path: path.join(root, "outside.md") },
    noopToolProgressSink,
  ),
  (error) => error.code === FILE_TOOL_ERROR_CODE.pathForbidden,
);

// Write handler：写入后 Read 可见。
const write = registry.require("Write");
await write.handler.execute(
  context,
  { file_path: designFile, content: "新正文\n" },
  noopToolProgressSink,
);
assert.equal(await fs.readFile(designFile, "utf8"), "新正文\n");

// Edit handler：replace_all=false 替换第一个。
const edit = registry.require("Edit");
await edit.handler.execute(
  context,
  { file_path: designFile, old_string: "正文", new_string: "章节" },
  noopToolProgressSink,
);
assert.equal(await fs.readFile(designFile, "utf8"), "新章节\n");

await fs.rm(root, { recursive: true, force: true });
console.log("file tools registry smoke passed");
