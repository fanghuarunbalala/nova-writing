/**
 * 工具上下文重建冒烟：工具请求/结果事件 → 消息投影 → Pi 转换
 * （toolUse/toolResult 配对），验证跨轮上下文包含工具历史。
 */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CoreConversationRuntimeMessageProjector,
  ToolRequestRecordedOutputEvent,
  ToolResultRecordedOutputEvent,
  UserMessageInputEvent,
  createCoreRuntimeMessageSchemaRegistry,
  noopLogger,
} from "../dist/index.js";
import { CorePiRuntimeMessageConverter } from "../dist/runtime/agent/pi/index.js";
import {
  NodeWorkspaceStoreLocator,
  SqliteWorkspaceStore,
} from "../dist/node/index.js";

const temporaryRoot = await mkdtemp(join(tmpdir(), "tool-context-rebuild-"));
const workspaceRoot = join(temporaryRoot, "workspace");
const storageRoot = join(temporaryRoot, "storage");
const conversationId = "conversation-tool-context";

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

  const appendInput = async (snapshot) =>
    store.journal.append({ direction: "input", snapshot });
  const appendOutput = async (event) =>
    store.journal.append({ direction: "output", snapshot: event.getSnapshot() });
  const user = (id, text, timestamp) =>
    new UserMessageInputEvent({
      id,
      conversationId,
      text,
      timestamp,
    }).getSnapshot();

  await appendInput(user("u1", "第一轮", "2026-08-07T02:00:00.000Z"));
  await appendOutput(
    new ToolRequestRecordedOutputEvent({
      id: "tr-req-1",
      record: {
        conversationId,
        runId: "run-1",
        turnId: "turn-1",
        toolCallId: "call-1",
        toolName: "NovelCharacterRead",
        toolVersion: "1.0.0",
        arguments: { characterId: "char-1" },
        truncated: false,
      },
    }),
  );
  await appendOutput(
    new ToolResultRecordedOutputEvent({
      id: "tr-res-1",
      record: {
        conversationId,
        runId: "run-1",
        turnId: "turn-1",
        toolCallId: "call-1",
        toolName: "NovelCharacterRead",
        toolVersion: "1.0.0",
        outcome: "ok",
        result: { name: "林晚", summary: "测试角色" },
        truncated: false,
      },
    }),
  );
  await appendInput(user("u2", "第二轮", "2026-08-07T02:01:00.000Z"));
  await appendOutput(
    new ToolResultRecordedOutputEvent({
      id: "tr-res-2",
      record: {
        conversationId,
        runId: "run-2",
        turnId: "turn-2",
        toolCallId: "call-2",
        toolName: "NovelOutlineRead",
        toolVersion: "1.0.0",
        outcome: "failed",
        errorCode: "NOVEL_OUTLINE_READ_FAILED",
        truncated: false,
      },
    }),
  );
  await appendInput(user("u3", "第三轮", "2026-08-07T02:02:00.000Z"));

  const projector = new CoreConversationRuntimeMessageProjector({
    logger: noopLogger,
  });
  const context = store.createMessageProjectionContext({ projector });
  const result = await context.projections.synchronize(conversationId);
  assert.deepEqual(result.operations, ["initialized", "caught_up"]);

  const page = await context.messages.list({ conversationId });
  const roles = page.items.map((item) => item.message.messageType);
  assert.deepEqual(roles, [
    "user.message",
    "tool.request",
    "tool.result",
    "user.message",
    "tool.result",
    "user.message",
  ]);

  const converter = new CorePiRuntimeMessageConverter({
    messageSchemaRegistry: createCoreRuntimeMessageSchemaRegistry(),
    assistantMessageEnvelopeFactory: {
      create: () => ({ api: "test-api", provider: "test-provider", model: "test-model" }),
    },
    logger: noopLogger,
  });
  const piMessages = await converter.convert({
    conversationId,
    runId: "run-latest",
    purpose: "context",
    messages: page.items.map((item) => item.message),
  });
  const toolUse = piMessages.find(
    (message) => message.role === "assistant" &&
      Array.isArray(message.content) &&
      message.content.some((block) => block.type === "toolCall"),
  );
  const toolResults = piMessages.filter((message) => message.role === "toolResult");
  assert.ok(toolUse, "toolUse should be present in Pi context");
  assert.equal(toolResults.length, 1, "only paired call-1 toolResult remains; orphan call-2 converts to user text");
  assert.equal(toolResults[0].toolCallId, "call-1");
  assert.equal(toolResults[0].isError, false);
  assert.ok(String(toolResults[0].content[0]?.text ?? "").includes("林晚"));
  // 孤儿 toolResult（call-2 无对应 toolRequest）必须降级为 user 文本消息，
  // 不再产出裸 toolResult，保持 1:1 消息数（context projection 不变量）。
  const orphanText = piMessages.find(
    (message) =>
      message.role === "user" &&
      String(message.content?.[0]?.text ?? "").includes("失败"),
  );
  assert.ok(orphanText, "orphan call-2 result should become a user text message");
  assert.ok(
    String(orphanText.content[0].text).includes("NOVEL_OUTLINE_READ_FAILED"),
  );

  // 重排验证：assistant toolCall(call-1) 后必须紧跟对应的 toolResult(call-1)。
  const call1Index = piMessages.findIndex(
    (message) =>
      message.role === "assistant" &&
      Array.isArray(message.content) &&
      message.content.some(
        (block) => block.type === "toolCall" && block.id === "call-1",
      ),
  );
  assert.ok(call1Index >= 0, "call-1 toolCall should exist");
  const follower = piMessages[call1Index + 1];
  assert.equal(follower?.role, "toolResult");
  assert.equal(follower?.toolCallId, "call-1");

  await context.close();
  await store.close();
  console.log("tool context rebuild smoke passed");
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
