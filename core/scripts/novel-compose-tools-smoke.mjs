/**
 * Compose 工具与审批生命周期挂钩冒烟。
 * Smoke for compose tools and the approval lifecycle hook.
 */
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  ComposeApprovalLifecycleSink,
  ComposeModeStateProvider,
  ComposeToolService,
  NovelComposeOutputEvent,
  ToolApprovalRequestedOutputEvent,
  ToolApprovalResolvedOutputEvent,
  createEnterComposeModeTool,
  createExitComposeModeTool,
  ToolError,
} from "../dist/index.js";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "compose-tools-smoke-"));
const designRoot = path.join(root, "design");
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
const composeState = new ComposeModeStateProvider();
const service = new ComposeToolService({
  composeState,
  designRoot,
  eventSink,
});
const enterTool = createEnterComposeModeTool({ service });
const exitTool = createExitComposeModeTool({ service });

const context = (conversationId, index) => ({
  conversationId,
  runId: `run-${index}`,
  toolCallId: `call-${index}`,
  signal: new AbortController().signal,
});
const progress = { async emit() {} };

const conversationId = "conversation:compose-tools";
const designFilePath = path.join(designRoot, "conversation-compose-tools.md");

// Enter 工具：建文件 + designing + begin 事件
const enterResult = await enterTool.handler.execute(
  context(conversationId, 1),
  { purpose: "设计第三章" },
  progress,
);
assert.equal(enterResult.details.phase, "designing");
assert.equal(enterResult.details.designFilePath, designFilePath);
assert.equal(await fs.readFile(designFilePath, "utf8"), "");
assert.equal(events.at(-1).getEventType(), "novel.compose.begin");

// 重复进入 → NOVEL_COMPOSE_STATE_INVALID
await assert.rejects(
  enterTool.handler.execute(context(conversationId, 2), {}, progress),
  (error) => error instanceof ToolError && error.code === "NOVEL_COMPOSE_STATE_INVALID",
);

// 审批请求挂钩：designing -> pending + submitted 事件
const requestedAt = "2026-08-07T00:00:01.000Z";
const requested = new ToolApprovalRequestedOutputEvent({
  id: "approval-request-1",
  approvalRequestId: "approval-request-1",
  conversationId,
  runId: "run-3",
  toolCallId: "call-3",
  toolName: "ExitComposeMode",
  toolVersion: "1.0.0",
  argumentDigest: `sha256:${"a".repeat(64)}`,
  summary: { title: "提交设计草稿" },
  requestedAt,
  expiresAt: "2026-08-07T00:15:00.000Z",
  timestamp: requestedAt,
});
const sink = new ComposeApprovalLifecycleSink(eventSink, composeState);
await sink.append(requested);
assert.equal(composeState.snapshot(conversationId).phase, "pending");
assert.ok(
  events.some((event) => event.getEventType() === "novel.compose.submitted"),
);

// 批准决议挂钩：approved 事件（状态 pending 保持到 handler 落库）
const resolvedAt = "2026-08-07T00:00:02.000Z";
const resolved = new ToolApprovalResolvedOutputEvent({
  id: "approval-resolved-1",
  conversationId,
  runId: "run-3",
  toolCallId: "call-3",
  toolName: "ExitComposeMode",
  toolVersion: "1.0.0",
  argumentDigest: `sha256:${"a".repeat(64)}`,
  approvalRequestId: "approval-request-1",
  decision: "approved",
  actorId: "smoke-user",
  resolvedAt,
  timestamp: resolvedAt,
});
await sink.append(resolved);
assert.ok(
  events.some((event) => event.getEventType() === "novel.compose.approved"),
);

// Exit 工具 handler（批准后执行）：pending -> applied + applied 事件
const exitResult = await exitTool.handler.execute(
  context(conversationId, 4),
  {},
  progress,
);
assert.equal(exitResult.details.phase, "applied");
assert.equal(composeState.snapshot(conversationId).active, false);
assert.equal(events.at(-1).getEventType(), "novel.compose.applied");

// 拒绝路径：重新进入 -> 提交 -> 拒绝 -> designing + rejected 事件
await enterTool.handler.execute(context(conversationId, 5), {}, progress);
const requested2 = new ToolApprovalRequestedOutputEvent({
  id: "approval-request-2",
  approvalRequestId: "approval-request-2",
  conversationId,
  runId: "run-6",
  toolCallId: "call-6",
  toolName: "ExitComposeMode",
  toolVersion: "1.0.0",
  argumentDigest: `sha256:${"b".repeat(64)}`,
  summary: { title: "提交设计草稿" },
  requestedAt: "2026-08-07T00:01:00.000Z",
  expiresAt: "2026-08-07T00:16:00.000Z",
  timestamp: "2026-08-07T00:01:00.000Z",
});
await sink.append(requested2);
assert.equal(composeState.snapshot(conversationId).phase, "pending");
const resolved2 = new ToolApprovalResolvedOutputEvent({
  id: "approval-resolved-2",
  conversationId,
  runId: "run-6",
  toolCallId: "call-6",
  toolName: "ExitComposeMode",
  toolVersion: "1.0.0",
  argumentDigest: `sha256:${"b".repeat(64)}`,
  approvalRequestId: "approval-request-2",
  decision: "rejected",
  actorId: "smoke-user",
  resolvedAt: "2026-08-07T00:01:01.000Z",
  timestamp: "2026-08-07T00:01:01.000Z",
});
await sink.append(resolved2);
assert.equal(composeState.snapshot(conversationId).phase, "designing");
assert.equal(composeState.snapshot(conversationId).active, true);
assert.ok(
  events.some((event) => event.getEventType() === "novel.compose.rejected"),
);

// 事件类型检查
assert.ok(
  events.some((event) => event instanceof NovelComposeOutputEvent),
);

await fs.rm(root, { recursive: true, force: true });
console.log("novel compose tools smoke passed");
