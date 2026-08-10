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
// 写序: compose.begin → mode.changed。
assert.equal(events.at(-2).getEventType(), "novel.compose.begin");
assert.equal(events.at(-1).getEventType(), "novel.mode.changed");
assert.equal(composeState.snapshot(conversationId).mode, "compose");

// 重复进入 → 幂等成功:alreadyActive=true、复用当前 design 文件、不重复发事件。
const reenterResult = await enterTool.handler.execute(
  context(conversationId, 2),
  {},
  progress,
);
assert.equal(reenterResult.details.alreadyActive, true);
assert.equal(reenterResult.details.phase, "designing");
assert.equal(reenterResult.details.designFilePath, designFilePath);
assert.equal(composeState.snapshot(conversationId).active, true);
// 幂等不新增 begin/mode.changed 事件(仅 approval 挂钩后续事件在队列中)。
assert.equal(events.at(-1).getEventType(), "novel.mode.changed");

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
assert.equal(composeState.snapshot(conversationId).mode, "review");
// 写序: compose.applied → mode.changed(恢复 preMode)。
assert.equal(events.at(-2).getEventType(), "novel.compose.applied");
assert.equal(events.at(-1).getEventType(), "novel.mode.changed");

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

// ---------------------------------------------------------------------------
// 审核中延迟 mode(approved 路径):提交 -> pending 中 setMode(bypass) 不 discard -> 批准
// -> service.exit() applied 后应用延迟 mode,最终 mode=bypass。
// ---------------------------------------------------------------------------
await enterTool.handler.execute(context(conversationId, 7), {}, progress);
const requested3 = new ToolApprovalRequestedOutputEvent({
  id: "approval-request-3",
  approvalRequestId: "approval-request-3",
  conversationId,
  runId: "run-8",
  toolCallId: "call-8",
  toolName: "ExitComposeMode",
  toolVersion: "1.0.0",
  argumentDigest: `sha256:${"c".repeat(64)}`,
  summary: { title: "提交设计草稿" },
  requestedAt: "2026-08-07T00:02:00.000Z",
  expiresAt: "2026-08-07T00:17:00.000Z",
  timestamp: "2026-08-07T00:02:00.000Z",
});
await sink.append(requested3);
assert.equal(composeState.snapshot(conversationId).phase, "pending");
// pending 中 setMode(bypass):延迟,不 discard、compose 保持 pending。
await service.setMode(conversationId, "bypass");
assert.equal(composeState.snapshot(conversationId).phase, "pending");
assert.equal(composeState.snapshot(conversationId).active, true);
assert.equal(
  events.some((event) => event.getEventType() === "novel.compose.discarded"),
  false,
  "pending 中 setMode 不应 discard",
);
const resolved3 = new ToolApprovalResolvedOutputEvent({
  id: "approval-resolved-3",
  conversationId,
  runId: "run-8",
  toolCallId: "call-8",
  toolName: "ExitComposeMode",
  toolVersion: "1.0.0",
  argumentDigest: `sha256:${"c".repeat(64)}`,
  approvalRequestId: "approval-request-3",
  decision: "approved",
  actorId: "smoke-user",
  resolvedAt: "2026-08-07T00:02:01.000Z",
  timestamp: "2026-08-07T00:02:01.000Z",
});
await sink.append(resolved3);
const exitDeferredApproved = await exitTool.handler.execute(
  context(conversationId, 9),
  {},
  progress,
);
assert.equal(exitDeferredApproved.details.phase, "applied");
assert.equal(composeState.snapshot(conversationId).active, false);
// 下一 call 晋升语义:approved + service.exit 后,延迟的 bypass 尚未生效(mode 仍为 preMode)。
assert.equal(
  composeState.snapshot(conversationId).mode,
  "review",
  "approved 后延迟 mode 未即时应用(仍 preMode)",
);
// 模拟下一次 provider call 的晋升。
await service.applyPendingModeTarget(conversationId);
assert.equal(
  composeState.snapshot(conversationId).mode,
  "bypass",
  "下一次 call 晋升后应用延迟的 bypass",
);

// ---------------------------------------------------------------------------
// 审核中延迟 mode(rejected 路径):提交 -> pending 中 setMode(bypass) -> 拒绝
// -> 延迟 bypass 仍 pending;下一次 call 晋升 → discard 离开 compose + mode=bypass。
// ---------------------------------------------------------------------------
await enterTool.handler.execute(context(conversationId, 10), {}, progress);
const requested4 = new ToolApprovalRequestedOutputEvent({
  id: "approval-request-4",
  approvalRequestId: "approval-request-4",
  conversationId,
  runId: "run-11",
  toolCallId: "call-11",
  toolName: "ExitComposeMode",
  toolVersion: "1.0.0",
  argumentDigest: `sha256:${"d".repeat(64)}`,
  summary: { title: "提交设计草稿" },
  requestedAt: "2026-08-07T00:03:00.000Z",
  expiresAt: "2026-08-07T00:18:00.000Z",
  timestamp: "2026-08-07T00:03:00.000Z",
});
await sink.append(requested4);
assert.equal(composeState.snapshot(conversationId).phase, "pending");
await service.setMode(conversationId, "bypass");
assert.equal(composeState.snapshot(conversationId).phase, "pending");
const resolved4 = new ToolApprovalResolvedOutputEvent({
  id: "approval-resolved-4",
  conversationId,
  runId: "run-11",
  toolCallId: "call-11",
  toolName: "ExitComposeMode",
  toolVersion: "1.0.0",
  argumentDigest: `sha256:${"d".repeat(64)}`,
  approvalRequestId: "approval-request-4",
  decision: "rejected",
  actorId: "smoke-user",
  resolvedAt: "2026-08-07T00:03:01.000Z",
  timestamp: "2026-08-07T00:03:01.000Z",
});
await sink.append(resolved4);
// reject → sink 仅回到 designing,延迟 bypass 尚未应用(active 仍 true)。
assert.equal(composeState.snapshot(conversationId).phase, "designing");
assert.equal(composeState.snapshot(conversationId).active, true);
assert.equal(
  events.some((event) => event.getEventType() === "novel.compose.discarded"),
  false,
  "reject 后延迟 mode 未即时 discard",
);
// 模拟下一次 provider call 晋升 → discard 离开 compose + mode=bypass。
await service.applyPendingModeTarget(conversationId);
assert.equal(composeState.snapshot(conversationId).active, false);
assert.equal(
  composeState.snapshot(conversationId).mode,
  "bypass",
  "下一次 call 晋升后应用延迟的 bypass(离开 compose)",
);
assert.ok(
  events.some((event) => event.getEventType() === "novel.compose.discarded"),
);

// ---------------------------------------------------------------------------
// write 审批探测延迟:挂起审批时 setMode(compose) 也延迟(不立即 begin)。
// ---------------------------------------------------------------------------
let pendingApprovalFlag = false;
service.setPendingApprovalProbe(async () => pendingApprovalFlag);
await service.setMode(conversationId, "review");
assert.equal(composeState.snapshot(conversationId).mode, "review");
// probe=true:setMode(compose) 延迟,compose 未激活。
pendingApprovalFlag = true;
await service.setMode(conversationId, "compose");
assert.equal(composeState.snapshot(conversationId).active, false);
assert.equal(composeState.snapshot(conversationId).mode, "review");
// probe=false + applyPendingModeTarget(下一 call 晋升) → begin,compose 激活。
pendingApprovalFlag = false;
await service.applyPendingModeTarget(conversationId);
assert.equal(composeState.snapshot(conversationId).active, true);
assert.equal(composeState.snapshot(conversationId).phase, "designing");

// 事件类型检查
assert.ok(
  events.some((event) => event instanceof NovelComposeOutputEvent),
);

await fs.rm(root, { recursive: true, force: true });
console.log("novel compose tools smoke passed");
