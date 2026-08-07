import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  NOVEL_OUTLINE_TOOL_GROUP_MANIFEST,
  captureNovelRevision,
  captureNovelTimestamp,
} from "../dist/index.js";
import {
  NodeNovelStoreLocator,
  NodeWorkspaceStoreLocator,
  SqliteNovelCanonicalStore,
  openChildNovelToolRegistry,
} from "../dist/node/index.js";

class FixedRevisionFactory {
  createRevision() {
    return captureNovelRevision("revision_child_registry_base");
  }
}

class CollectingLogger {
  constructor(entries = [], bindings = {}) {
    this.entries = entries;
    this.bindings = bindings;
  }
  debug(event, fields = {}) { this.record("debug", event, fields); }
  info(event, fields = {}) { this.record("info", event, fields); }
  warn(event, fields = {}) { this.record("warn", event, fields); }
  error(event, fields = {}) { this.record("error", event, fields); }
  child(bindings) {
    return new CollectingLogger(this.entries, { ...this.bindings, ...bindings });
  }
  record(level, event, fields) {
    this.entries.push({ level, event, fields: { ...this.bindings, ...fields } });
  }
}

const root = await mkdtemp(join(tmpdir(), "child-novel-tool-registry-"));
const logs = [];
const logger = new CollectingLogger(logs);

const context = (conversationId, index) => ({
  conversationId,
  runId: `run_${conversationId}_${index}`,
  toolCallId: `call_${conversationId}_${index}`,
  signal: new AbortController().signal,
});
const progress = { async emit() {} };

try {
  const workspaceRoot = join(root, "workspace");
  await mkdir(workspaceRoot, { recursive: true });
  const workspace = await new NodeWorkspaceStoreLocator({
    storageRoot: join(root, "storage"),
  }).resolve(workspaceRoot);
  const location = await new NodeNovelStoreLocator().resolve(workspace);
  const canonicalStore = await SqliteNovelCanonicalStore.open({
    location,
    revisionFactory: new FixedRevisionFactory(),
    logger,
  });
  await canonicalStore.close();

  const todoWriter = {
    replace: async () =>
      Object.freeze({
        snapshot: Object.freeze({
          conversationId: "c",
          revision: 1,
          todos: [],
          updatedAt: captureNovelTimestamp("2026-08-06T00:00:00.000Z"),
        }),
        eventSequence: 1,
      }),
  };
  const novelTools = await openChildNovelToolRegistry({
    storageRoot: join(root, "storage"),
    workdir: workspaceRoot,
    todoWriter,
    logger,
  });

  // 注册表包含全部真实 novel 工具 + TodoWrite，不包含 draft 工具。
  const names = novelTools.registry.list().map((tool) => tool.descriptor.name);
  assert.ok(names.includes("NovelOutlineWrite"));
  assert.ok(names.includes("NovelCharacterWrite"));
  assert.ok(names.includes("NovelDelete"));
  assert.ok(names.includes("TodoWrite"));
  assert.ok(names.includes("Read"));
  assert.ok(names.includes("Glob"));
  assert.ok(names.includes("Write"));
  assert.ok(names.includes("Edit"));
  assert.equal(names.includes("NovelDraftStatus"), false);
  assert.equal(novelTools.groups.has("runtime.files"), true);
  assert.deepEqual(NOVEL_OUTLINE_TOOL_GROUP_MANIFEST.tools, [
    "NovelOutlineRead",
    "NovelOutlineWrite",
    "NovelOutlineEdit",
  ]);

  const conversation = "conversation_child_registry";

  // 真实执行：写入 outline 并读回（不再走 manifest 桩）。
  const writeTool = novelTools.registry.require("NovelOutlineWrite");
  const writeResult = await writeTool.handler.execute(
    context(conversation, 1),
    {
      baseRevision: "revision_child_registry_base",
      values: [
        { id: "story_unit_child", title: "Child written unit" },
        {
          id: "story_unit_leaf_child",
          title: "Leaf",
          parentId: "story_unit_child",
        },
      ],
    },
    progress,
  );
  assert.deepEqual(
    writeResult.details.items.map((item) => [item.id, item.status]),
    [
      ["story_unit_child", "applied"],
      ["story_unit_leaf_child", "applied"],
    ],
  );
  const writeRevision = writeResult.details.revision.currentRevision;
  assert.notEqual(writeRevision, "revision_child_registry_base");

  const readTool = novelTools.registry.require("NovelOutlineRead");
  const readResult = await readTool.handler.execute(
    context(conversation, 2),
    {},
    progress,
  );
  assert.equal(readResult.details.units.length, 2);
  assert.equal(readResult.details.units[0].title, "Child written unit");
  assert.equal(readResult.details.revision.currentRevision, writeRevision);

  // 乐观锁：过期 baseRevision 被拒绝（真实 writer 校验）。
  await assert.rejects(
    writeTool.handler.execute(
      context(conversation, 3),
      {
        baseRevision: "revision_child_registry_base",
        values: [{ id: "story_unit_stale", title: "Stale" }],
      },
      progress,
    ),
    (error) => {
      assert.equal(error.code, "NOVEL_OUTLINE_WRITE_FAILED");
      return true;
    },
  );

  // 日志脱敏：不暴露正文内容与路径。
  const serialized = JSON.stringify(logs);
  for (const forbidden of ["Child written unit", root]) {
    assert.equal(serialized.includes(forbidden), false);
  }

  console.log("child novel tool registry smoke passed");
} finally {
  await rm(root, { recursive: true, force: true });
}
