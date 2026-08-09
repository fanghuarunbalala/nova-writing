/**
 * 工具上下文重建冒烟：工具请求/结果事件 → 消息投影 → Pi 转换
 * （toolUse/toolResult 配对），验证跨轮上下文包含工具历史；
 * 含「文本 + 4×工具调用」合并轮次回归（跨 run 回放不得产生连续 assistant）。
 */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AgentAssistantMessageCompletedOutputEvent,
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

  // ── 合并轮次回归（真实崩溃场景）：跨 run 回放「文本 + 4×工具调用」的会话时，
  // 4 个 tool.request 必须折叠进前一条 assistant.message 的 Pi 消息，产出
  // 恰好一条 assistant（content = [text, toolCall×4]）+ 4 条 toolResult。
  // 不得拆成连续独立 assistant 消息——那是 OpenAI-completions provider 400 拒绝
  // → child runtime 心跳不健康 → SIGTERM 崩溃的根因（provider-requests.jsonl entry 5）。
  const mergedConversationId = "conversation-tool-context-merged";
  await store.conversations.createConversation({
    id: mergedConversationId,
    workspaceId: location.workspaceId,
    agent: { agentType: "novel.main", definitionVersion: "1" },
  });
  const mergedUser = (id, text, timestamp) =>
    new UserMessageInputEvent({
      id,
      conversationId: mergedConversationId,
      text,
      timestamp,
    }).getSnapshot();
  await appendInput(mergedUser("um-1", "第四轮", "2026-08-07T02:03:00.000Z"));
  await appendOutput(
    new AgentAssistantMessageCompletedOutputEvent({
      id: "am-m1",
      conversationId: mergedConversationId,
      runId: "run-merged",
      turnId: "turn-merged-1",
      timestamp: "2026-08-07T02:03:10.000Z",
      assistantMessageId: "assistant-m1",
      content: [{ type: "text", text: "第四轮：合并工具调用" }],
      completionReason: "stop",
      hasToolCalls: true,
    }),
  );
  const mergedTools = [
    { id: "call-m1", name: "NovelCharacterRead" },
    { id: "call-m2", name: "NovelOutlineRead" },
    { id: "call-m3", name: "NovelParagraphRead" },
    { id: "call-m4", name: "NovelLocationRead" },
  ];
  // 请求在 dispatch 时全部落盘（一条 assistant 文本后连续 4 条 tool.request）。
  for (const [i, call] of mergedTools.entries()) {
    await appendOutput(
      new ToolRequestRecordedOutputEvent({
        id: `tr-m-req-${i + 1}`,
        record: {
          conversationId: mergedConversationId,
          runId: "run-merged",
          turnId: "turn-merged-1",
          toolCallId: call.id,
          toolName: call.name,
          toolVersion: "1.0.0",
          arguments: { index: i + 1 },
          truncated: false,
        },
      }),
    );
  }
  // 结果按完成顺序落盘（与请求顺序不同，模拟真实时序），验证折叠后结果仍分组。
  for (const [i, callId] of ["call-m1", "call-m3", "call-m2", "call-m4"].entries()) {
    await appendOutput(
      new ToolResultRecordedOutputEvent({
        id: `tr-m-res-${i + 1}`,
        record: {
          conversationId: mergedConversationId,
          runId: "run-merged",
          turnId: "turn-merged-1",
          toolCallId: callId,
          toolName: mergedTools.find((call) => call.id === callId).name,
          toolVersion: "1.0.0",
          outcome: "ok",
          result: { done: callId },
          truncated: false,
        },
      }),
    );
  }

  await context.projections.synchronize(mergedConversationId);
  const mergedPage = await context.messages.list({ conversationId: mergedConversationId });
  assert.deepEqual(
    mergedPage.items.map((item) => item.message.messageType),
    [
      "user.message",
      "assistant.message",
      "tool.request",
      "tool.request",
      "tool.request",
      "tool.request",
      "tool.result",
      "tool.result",
      "tool.result",
      "tool.result",
    ],
  );

  const mergedPi = await converter.convert({
    conversationId: mergedConversationId,
    runId: "run-merged-latest",
    purpose: "context",
    messages: mergedPage.items.map((item) => item.message),
  });
  const mergedAssistants = mergedPi.filter((message) => message.role === "assistant");
  assert.equal(
    mergedAssistants.length,
    1,
    "merged turn must yield exactly one assistant Pi message (no consecutive assistants)",
  );
  const mergedAssistant = mergedAssistants[0];
  assert.ok(Array.isArray(mergedAssistant.content));
  const textBlock = mergedAssistant.content.find((block) => block.type === "text");
  assert.ok(textBlock, "assistant content keeps the text block");
  assert.ok(String(textBlock.text).includes("第四轮"));
  const mergedToolCalls = mergedAssistant.content.filter(
    (block) => block.type === "toolCall",
  );
  assert.equal(mergedToolCalls.length, 4, "4 tool calls folded into one assistant message");
  assert.deepEqual(
    mergedToolCalls.map((block) => block.id),
    ["call-m1", "call-m2", "call-m3", "call-m4"],
  );
  const mergedToolResults = mergedPi.filter((message) => message.role === "toolResult");
  assert.equal(mergedToolResults.length, 4, "4 grouped tool results follow the merged assistant");
  assert.equal(
    mergedPi[mergedPi.indexOf(mergedAssistant) + 1].role,
    "toolResult",
    "merged assistant is immediately followed by a grouped tool result",
  );
  assert.deepEqual(
    mergedToolResults.map((message) => message.toolCallId),
    ["call-m1", "call-m3", "call-m2", "call-m4"],
  );
  // 10 条 canonical 记录 → 1 user + 1 assistant + 4 toolResult = 6 条 Pi 消息
  //（4 个 tool.request 被折叠进 assistant，不再各占一条）。
  assert.equal(mergedPi.length, 6, "4 toolRequests are folded away into the assistant");

  await context.close();
  await store.close();
  console.log("tool context rebuild smoke passed");
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
