/**
 * 多轮工具轮次上下文冒烟：模拟 3 轮 user + 带工具调用的 assistant 回复，
 * 验证消息投影包含全部历史（工具轮次的助手文本不再被丢弃），
 * 供上下文组装使用。
 */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AgentAssistantMessageCompletedOutputEvent,
  CompositeRuntimeMessageProjector,
  CoreConversationRuntimeMessageProjector,
  UserMessageInputEvent,
  createCoreRuntimeMessageSchemaRegistry,
  noopLogger,
} from "../dist/index.js";
import {
  NodeWorkspaceStoreLocator,
  SqliteWorkspaceStore,
} from "../dist/node/index.js";

const temporaryRoot = await mkdtemp(join(tmpdir(), "multi-turn-tool-context-"));
const workspaceRoot = join(temporaryRoot, "workspace");
const storageRoot = join(temporaryRoot, "storage");
const conversationId = "conversation-multi-turn";

try {
  await mkdir(workspaceRoot, { recursive: true });
  const location = await new NodeWorkspaceStoreLocator({ storageRoot }).resolve(
    workspaceRoot,
  );
  const store = await SqliteWorkspaceStore.open({ workspace: location, logger: noopLogger });
  await store.conversations.createConversation({
    id: conversationId,
    workspaceId: location.workspaceId,
    agent: { agentType: "novel.main", definitionVersion: "1" },
  });

  const append = async (direction, snapshot) => {
    await store.journal.append({ direction, snapshot });
  };
  const user = (id, text, timestamp) =>
    new UserMessageInputEvent({
      id,
      conversationId,
      text,
      timestamp,
    }).getSnapshot();
  const assistant = (id, text, timestamp, toolCalls) =>
    new AgentAssistantMessageCompletedOutputEvent({
      id,
      conversationId,
      runId: `run-${id}`,
      turnId: `turn-${id}`,
      assistantMessageId: `assistant-${id}`,
      timestamp,
      content: [{ type: "text", text }],
      completionReason: toolCalls ? "tool_use" : "stop",
      hasToolCalls: toolCalls,
    }).getSnapshot();

  await append("input", user("u1", "第一轮：介绍大纲", "2026-08-07T01:00:00.000Z"));
  await append(
    "output",
    assistant("a1", "第一轮助手回复（工具轮次）", "2026-08-07T01:00:01.000Z", true),
  );
  await append("input", user("u2", "第二轮：创建角色", "2026-08-07T01:01:00.000Z"));
  await append(
    "output",
    assistant("a2", "第二轮助手回复（工具轮次）", "2026-08-07T01:01:01.000Z", true),
  );
  await append("input", user("u3", "第三轮：创建地点", "2026-08-07T01:02:00.000Z"));

  const composite = new CompositeRuntimeMessageProjector({
    id: "smoke.runtime-message",
    version: "1",
    projectors: [new CoreConversationRuntimeMessageProjector({ logger: noopLogger })],
    messageSchemaRegistry: createCoreRuntimeMessageSchemaRegistry(),
    logger: noopLogger,
  });
  const context = store.createMessageProjectionContext({ projector: composite });
  const result = await context.projections.synchronize(conversationId);
  assert.deepEqual(result.operations, ["initialized", "caught_up"]);

  const page = await context.messages.list({ conversationId });
  assert.equal(page.items.length, 5, "3 user + 2 assistant tool-round replies");
  const roles = page.items.map((item) => item.message.role);
  assert.deepEqual(roles, ["user", "assistant", "user", "assistant", "user"]);
  const assistantTexts = page.items
    .filter((item) => item.message.role === "assistant")
    .map((item) => item.message.payload.content[0].text);
  assert.deepEqual(assistantTexts, [
    "第一轮助手回复（工具轮次）",
    "第二轮助手回复（工具轮次）",
  ]);

  await context.close();
  await store.close();
  console.log("multi turn tool context smoke passed");
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
