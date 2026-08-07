/**
 * 全局审批查询冒烟：两个会话写入审批事件后，验证跨会话聚合结果
 * （含 conversationId/turnId/操作行/完整参数/已决状态）。
 */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DefaultNovelApiClient,
  ToolApprovalRequestedOutputEvent,
  ToolApprovalResolvedOutputEvent,
} from "../dist/index.js";
import {
  NodeConversationApiApplication,
  NodeWorkspaceStoreLocator,
} from "../dist/node/index.js";

class TestRuntimeHandle {
  constructor(conversationId, runtimeInstanceId) {
    this.conversationId = conversationId;
    this.runtimeInstanceId = runtimeInstanceId;
  }
  async dispatchInput() {}
  async shutdown() {
    return { kind: "stopped", exitedAt: "2026-08-07T02:00:00.000Z", reason: "smoke" };
  }
  waitForExit() {
    return new Promise(() => {});
  }
}

class TestRuntimePlacement {
  constructor() {
    this.handles = [];
  }
  async activate(bootstrap) {
    const handle = new TestRuntimeHandle(
      bootstrap.conversation.metadata.id,
      bootstrap.runtimeInstanceId,
    );
    this.handles.push(handle);
    return handle;
  }
}

const temporaryRoot = await mkdtemp(join(tmpdir(), "global-approval-query-"));
const workspaceRoot = join(temporaryRoot, "workspace");
const storageRoot = join(temporaryRoot, "storage");
const digest = `sha256:${"a".repeat(64)}`;
let nextSequence = 0;

try {
  await mkdir(workspaceRoot, { recursive: true });
  const workspace = await new NodeWorkspaceStoreLocator({ storageRoot }).resolve(
    workspaceRoot,
  );
  const application = await NodeConversationApiApplication.open({
    workspace,
    placement: new TestRuntimePlacement(),
  });
  const client = new DefaultNovelApiClient({
    transport: application.transport,
  });

  const first = await client.conversations.create({
    agent: { agentType: "novel", definitionVersion: "1.1.0" },
  });
  const second = await client.conversations.create({
    agent: { agentType: "novel", definitionVersion: "1.1.0" },
  });

  const publish = async (event) => {
    nextSequence += 1;
    await application.outputPublisher.publish(event);
  };

  // 会话一：一个已批准的审批（带参数与 turnId）。
  await publish(
    new ToolApprovalRequestedOutputEvent({
      id: "approval-a1-requested",
      conversationId: first.id,
      runId: "run-a1",
      turnId: "turn-a1",
      approvalRequestId: "approval-a1",
      toolCallId: "call-a1",
      toolName: "NovelCharacterWrite",
      toolVersion: "1.0.0",
      argumentDigest: digest,
      summary: {
        title: "新增角色",
        operations: [{ op: "add", kind: "character", title: "张三" }],
        arguments: { values: [{ name: "张三" }] },
      },
      requestedAt: "2026-08-07T02:00:01.000Z",
      expiresAt: "2026-08-07T02:15:01.000Z",
    }),
  );
  await publish(
    new ToolApprovalResolvedOutputEvent({
      id: "approval-a1-resolved",
      conversationId: first.id,
      runId: "run-a1",
      turnId: "turn-a1",
      approvalRequestId: "approval-a1",
      toolCallId: "call-a1",
      toolName: "NovelCharacterWrite",
      toolVersion: "1.0.0",
      argumentDigest: digest,
      decision: "approved",
      actorId: "smoke-user",
      resolvedAt: "2026-08-07T02:01:00.000Z",
    }),
  );

  // 会话二：一个待批准的审批。
  await publish(
    new ToolApprovalRequestedOutputEvent({
      id: "approval-b1-requested",
      conversationId: second.id,
      runId: "run-b1",
      turnId: "turn-b1",
      approvalRequestId: "approval-b1",
      toolCallId: "call-b1",
      toolName: "NovelLocationWrite",
      toolVersion: "1.0.0",
      argumentDigest: digest,
      summary: {
        title: "新增地点",
        operations: [{ op: "add", kind: "location", title: "青云镇" }],
        arguments: { values: [{ name: "青云镇" }] },
      },
      requestedAt: "2026-08-07T02:02:00.000Z",
      expiresAt: "2026-08-07T02:17:00.000Z",
    }),
  );

  const approvals = await client.conversations.listApprovals();
  assert.equal(approvals.length, 2);
  const a1 = approvals.find((item) => item.approvalRequestId === "approval-a1");
  const b1 = approvals.find((item) => item.approvalRequestId === "approval-b1");
  assert.ok(a1);
  assert.ok(b1);
  assert.equal(a1.conversationId, first.id);
  assert.equal(a1.status, "approved");
  assert.equal(a1.turnId, "turn-a1");
  assert.equal(a1.actorId, "smoke-user");
  assert.deepEqual(a1.operations, [{ op: "add", kind: "character", title: "张三" }]);
  assert.deepEqual(a1.arguments, { values: [{ name: "张三" }] });
  assert.equal(b1.conversationId, second.id);
  assert.equal(b1.status, "pending");
  assert.equal(b1.turnId, "turn-b1");
  assert.deepEqual(b1.operations, [{ op: "add", kind: "location", title: "青云镇" }]);
  assert.deepEqual(b1.arguments, { values: [{ name: "青云镇" }] });

  await application.close();
  console.log("global approval query smoke passed");
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
