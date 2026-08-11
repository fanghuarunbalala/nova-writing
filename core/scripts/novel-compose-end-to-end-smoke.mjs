/**
 * Compose 端到端冒烟：模式切换 + 工具执行 + 审批全链路 + 审计/归档 + 动态提示段。
 * End-to-end smoke: mode switching, tool execution, full approval flow, audit/archive,
 * and the dynamic prompt section switching with state.
 */
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Type } from "typebox";
import {
  INPUT_EVENT_TYPE,
  INPUT_PRIORITY,
  ComposeModeStateProvider,
  ComposeToolService,
  NOVEL_COMPOSE_TOOL_GROUP_MANIFEST,
  RUNTIME_FILES_TOOL_GROUP_MANIFEST,
  ToolError,
  ToolGroupCatalog,
  ToolRegistry,
  ToolRegistryView,
  createFileToolRegistry,
  createNovelComposeToolRegistry,
  defineTool,
  FILE_TOOL_ERROR_CODE,
  FileToolService,
} from "../dist/index.js";
import {
  CHILD_TOOL_PERMISSION_RULES,
  createChildToolExecutionComposition,
} from "../dist/node/index.js";
import {
  NodeNovelStoreLocator,
  NodeWorkspaceStoreLocator,
  SqliteNovelCanonicalStore,
  SqliteNovelComposeCommitStore,
} from "../dist/node/index.js";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "compose-e2e-smoke-"));
const workspaceRoot = path.join(root, "workspace");
await fs.mkdir(workspaceRoot, { recursive: true });
const workspace = await new NodeWorkspaceStoreLocator({
  storageRoot: path.join(root, "storage"),
}).resolve(workspaceRoot);
const location = await new NodeNovelStoreLocator().resolve(workspace);
const canonicalStore = await SqliteNovelCanonicalStore.open({ location });
const novelId = (await canonicalStore.getMetadata()).novelId;
await canonicalStore.close();

const events = [];
const eventSink = {
  async append(event) {
    events.push(event);
    return {
      status: "recorded",
      conversationId: event.conversationId,
      eventId: `evt-${events.length}`,
      sequence: events.length,
      recordedAt: "2026-08-07T00:00:00.000Z",
    };
  },
};

const designRoot = path.join(workspaceRoot, ".novel", "design");
const conversationId = "conversation:e2e";
const designFilePath = path.join(designRoot, "conversation-e2e.md");
const composeState = new ComposeModeStateProvider();
const composeService = new ComposeToolService({
  composeState,
  designRoot,
  eventSink,
  commitRecorder: new SqliteNovelComposeCommitStore({ location, novelId }),
});
const fileService = new FileToolService({
  sandboxRoot: workspaceRoot,
});

const executed = [];
const fakeCanonicalWrite = defineTool({
  descriptor: {
    name: "NovelParagraphWrite",
    version: "1.0.0",
    label: "Novel Paragraph Write",
    description: "Fake canonical write for e2e permission checks.",
    parameters: Type.Object({ values: Type.Array(Type.Any()) }),
  },
  handler: {
    async execute() {
      executed.push("NovelParagraphWrite");
      return { content: [{ type: "text", text: "ok" }] };
    },
  },
});

const registry = new ToolRegistry([
  ...createNovelComposeToolRegistry({ service: composeService }).list(),
  ...createFileToolRegistry({ service: fileService }).list(),
  fakeCanonicalWrite,
]);
const groups = new ToolGroupCatalog([
  NOVEL_COMPOSE_TOOL_GROUP_MANIFEST,
  RUNTIME_FILES_TOOL_GROUP_MANIFEST,
  {
    schemaVersion: 1,
    id: "novel.paragraph",
    version: "1.0.0",
    label: "Novel Paragraphs",
    tools: ["NovelParagraphWrite"],
  },
]);
const view = new ToolRegistryView({
  registry,
  groups,
  policy: { groupIds: ["novel.compose", "runtime.files", "novel.paragraph"] },
});
const composition = createChildToolExecutionComposition({
  registryView: view,
  eventSink,
  runtimeInstanceId: "runtime-instance-smoke",
  composeStateProvider: composeState,
});
const signal = new AbortController().signal;

function dispatch(toolName, toolCallId, arguments_) {
  return composition.dispatcher.execute(
    {
      conversationId,
      runId: "run-e2e",
      toolCallId,
      toolName,
      toolVersion: "1.0.0",
      arguments: arguments_,
    },
    { signal },
  );
}

async function waitForPending(toolName) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const pending = await composition.coordinator.listPending();
    const request = pending.find(
      (candidate) => candidate.identity.toolName === toolName,
    );
    if (request !== undefined) return request;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`no pending approval for ${toolName}`);
}

async function resolveApproval(request, decision, sequence, actorId = "smoke-user") {
  await composition.coordinator.resolve(
    {
      id: `decision-${sequence}`,
      conversationId,
      eventType: INPUT_EVENT_TYPE.approvalDecision,
      direction: "input",
      priority: INPUT_PRIORITY.command,
      sequence,
      timestamp: "2026-08-07T00:00:00.000Z",
      runId: request.identity.runId,
      payload: {
        approvalRequestId: request.approvalRequestId,
        decision,
        argumentDigest: request.identity.argumentDigest,
      },
    },
    { actorId },
  );
}

// 初始：idle。
assert.equal(composeState.snapshot(conversationId).phase, "idle");

// 1. EnterComposeMode -> designing + begin 事件 + design 文件创建
await dispatch("EnterComposeMode", "call-enter", { purpose: "第三章" });
assert.equal(composeState.snapshot(conversationId).phase, "designing");
assert.equal(composeState.snapshot(conversationId).purpose, "第三章");
assert.ok(
  events.some((event) => event.getEventType() === "novel.compose.begin"),
);

// 2. 草稿写入 design 文件（workspace 相对路径）
// （设计模式约束已迁移为 nudge 瞬态 system.reminder，见 nudge-definitions-smoke。）
await dispatch("Write", "call-write", {
  file_path: ".novel/design/conversation-e2e.md",
  content: "第三章正文草稿\n",
});
assert.equal(await fs.readFile(designFilePath, "utf8"), "第三章正文草稿\n");

// 3. compose 激活期间：越出沙盒（绝对/相对逃逸路径）被 FileToolService 拒绝、canonical 写拒绝
await assert.rejects(
  dispatch("Read", "call-read-outside", {
    file_path: path.join(workspaceRoot, "outside.md"),
  }),
  (error) =>
    error instanceof ToolError && error.code === FILE_TOOL_ERROR_CODE.pathForbidden,
);
await assert.rejects(
  dispatch("NovelParagraphWrite", "call-canonical", {
    values: [{ id: "p", text: "x" }],
  }),
  (error) => error instanceof ToolError && error.code === "TOOL_PERMISSION_DENIED",
);

// 4. ExitComposeMode -> ask -> submitted/pending
const exitPromise = dispatch("ExitComposeMode", "call-exit", {
  summary: "第三章正文草稿已完成",
});
const exitRequest = await waitForPending("ExitComposeMode");
assert.equal(exitRequest.summary.title, "提交设计草稿");
// 审批上下文：设计文件路径（workspace 相对，正斜杠）+ 模型提交说明。
assert.ok(
  exitRequest.summary.description.includes(
    "设计文件：.novel/design/conversation-e2e.md",
  ),
);
assert.deepEqual(exitRequest.summary.arguments, {
  summary: "第三章正文草稿已完成",
});
assert.equal(composeState.snapshot(conversationId).phase, "pending");
assert.ok(
  events.some((event) => event.getEventType() === "novel.compose.submitted"),
);

// 5. 批准 -> approved 事件 + Exit handler 落库（applied + 审计 + 归档）
await resolveApproval(exitRequest, "approved", 1);
await exitPromise;
assert.equal(composeState.snapshot(conversationId).phase, "applied");
assert.equal(composeState.snapshot(conversationId).active, false);
assert.ok(
  events.some((event) => event.getEventType() === "novel.compose.approved"),
);
assert.ok(
  events.some((event) => event.getEventType() === "novel.compose.applied"),
);
const archivePath = path.join(designRoot, "archive", "conversation-e2e.md");
assert.equal(await fs.readFile(archivePath, "utf8"), "第三章正文草稿\n");
await assert.rejects(fs.access(designFilePath));
const database = new DatabaseSync(location.canonicalDatabasePath, {
  readOnly: true,
});
let auditRow;
try {
  auditRow = database
    .prepare("SELECT design_id FROM novel_compose_commits WHERE design_id = ?")
    .get("conversation-e2e");
} finally {
  database.close();
}
assert.ok(auditRow);

// 6. 批准后：模式恢复 -> 文件工具仍放行（沙盒内相对路径）、canonical 写回到 ask
await dispatch("Write", "call-after-write", {
  file_path: ".novel/design/recovered.md",
  content: "x",
});
assert.equal(
  await fs.readFile(path.join(designRoot, "recovered.md"), "utf8"),
  "x",
);
const canonicalPromise = dispatch("NovelParagraphWrite", "call-after-canonical", {
  values: [{ id: "p2", text: "y" }],
});
const canonicalRequest = await waitForPending("NovelParagraphWrite");
assert.ok(canonicalRequest);
await resolveApproval(canonicalRequest, "approved", 2);
await canonicalPromise;
assert.deepEqual(executed, ["NovelParagraphWrite"]);

// 7. 拒绝路径：重新进入 -> 提交 -> 拒绝 -> 回到 designing + rejected 事件
await dispatch("EnterComposeMode", "call-enter-2", {});
const exitPromise2 = dispatch("ExitComposeMode", "call-exit-2", {
  summary: "第二版草稿",
});
const exitRequest2 = await waitForPending("ExitComposeMode");
await resolveApproval(exitRequest2, "rejected", 3);
await assert.rejects(() => exitPromise2, (error) => error.code === "TOOL_APPROVAL_REJECTED");
assert.equal(composeState.snapshot(conversationId).phase, "designing");
assert.equal(composeState.snapshot(conversationId).active, true);
assert.ok(
  events.some((event) => event.getEventType() === "novel.compose.rejected"),
);

await fs.rm(root, { recursive: true, force: true });
console.log("novel compose end-to-end smoke passed");
