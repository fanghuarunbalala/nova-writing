import assert from "node:assert/strict";
import {
  AGENT_RUNTIME_INVOCATION_KIND,
  AGENT_RUNTIME_OUTCOME,
  BaseContextCompiler,
  CONTEXT_COMPILE_FAILURE,
  ContextCompileError,
} from "../dist/index.js";

const forbidden = [
  "FORBIDDEN_SYSTEM_PROMPT",
  "FORBIDDEN_NOVEL_TEXT",
  "FORBIDDEN_WORK_PATH",
  "FORBIDDEN_MESSAGE_PAYLOAD",
];

const logs = [];
const logger = {
  debug: (event, fields) => logs.push({ level: "debug", event, fields }),
  info: (event, fields) => logs.push({ level: "info", event, fields }),
  warn: (event, fields) => logs.push({ level: "warn", event, fields }),
  error: (event, fields) => logs.push({ level: "error", event, fields }),
  child: () => logger,
};

function userMessage(id, conversationId, text) {
  return {
    id,
    conversationId,
    role: "user",
    messageType: "user.message",
    schemaVersion: 1,
    timestamp: "2026-08-01T00:00:00.000Z",
    payload: {
      content: [{ type: "text", text }],
    },
  };
}

const source = userMessage(
  "message-1",
  "conversation-agent-foundation",
  "FORBIDDEN_NOVEL_TEXT FORBIDDEN_MESSAGE_PAYLOAD",
);
const requestMessages = [source];
const compiler = new BaseContextCompiler({ logger });
const compiled = await compiler.compile({
  conversationId: "conversation-agent-foundation",
  runId: "run-agent-foundation",
  systemPrompt: "FORBIDDEN_SYSTEM_PROMPT FORBIDDEN_WORK_PATH",
  messages: requestMessages,
});

assert.equal(compiled.systemPrompt, "FORBIDDEN_SYSTEM_PROMPT FORBIDDEN_WORK_PATH");
assert.equal(compiled.messages.length, 1);
assert.notEqual(compiled.messages[0], source);
assert.deepEqual(compiled.messages[0], source);
assert.equal(Object.isFrozen(compiled), true);
assert.equal(Object.isFrozen(compiled.messages), true);
assert.equal(Object.isFrozen(compiled.messages[0]), true);
assert.equal(Object.isFrozen(compiled.messages[0].payload), true);
assert.equal(Object.isFrozen(compiled.messages[0].payload.content), true);

source.payload.content[0].text = "mutated source";
requestMessages.push(userMessage("message-2", "conversation-agent-foundation", "later"));
assert.equal(
  compiled.messages[0].payload.content[0].text,
  "FORBIDDEN_NOVEL_TEXT FORBIDDEN_MESSAGE_PAYLOAD",
);
assert.equal(compiled.messages.length, 1);

await assert.rejects(
  () =>
    compiler.compile({
      conversationId: "conversation-agent-foundation",
      runId: "run-mismatch",
      systemPrompt: "safe",
      messages: [userMessage("message-mismatch", "different-conversation", "safe")],
    }),
  (error) =>
    error instanceof ContextCompileError &&
    error.failure === CONTEXT_COMPILE_FAILURE.conversationMismatch,
);

const duplicate = userMessage(
  "message-duplicate",
  "conversation-agent-foundation",
  "safe",
);
await assert.rejects(
  () =>
    compiler.compile({
      conversationId: "conversation-agent-foundation",
      runId: "run-duplicate",
      systemPrompt: "safe",
      messages: [duplicate, duplicate],
    }),
  (error) =>
    error instanceof ContextCompileError &&
    error.failure === CONTEXT_COMPILE_FAILURE.duplicateMessage,
);

await assert.rejects(
  () =>
    compiler.compile({
      conversationId: "conversation-agent-foundation",
      runId: "run-unknown",
      systemPrompt: "safe",
      messages: [
        {
          ...userMessage("message-unknown", "conversation-agent-foundation", "safe"),
          messageType: "custom.unknown",
        },
      ],
    }),
  (error) =>
    error instanceof ContextCompileError &&
    error.failure === CONTEXT_COMPILE_FAILURE.invalidMessage,
);

const fakeAdapter = {
  stream: async (request) => ({
    conversationId: request.conversationId,
    runId: request.runId,
    outcome: AGENT_RUNTIME_OUTCOME.completed,
  }),
  cancel: async () => undefined,
};
const result = await fakeAdapter.stream({
  conversationId: compiled.conversationId,
  runId: compiled.runId,
  context: compiled,
  invocation: {
    kind: AGENT_RUNTIME_INVOCATION_KIND.continue,
  },
});
assert.deepEqual(result, {
  conversationId: "conversation-agent-foundation",
  runId: "run-agent-foundation",
  outcome: AGENT_RUNTIME_OUTCOME.completed,
});

const serializedLogs = JSON.stringify(logs);
for (const token of forbidden) assert.equal(serializedLogs.includes(token), false);
assert.equal(
  logs.some((record) => record.event === "runtime.context.compile_completed"),
  true,
);
assert.equal(
  logs.some((record) => record.event === "runtime.context.compile_failed"),
  true,
);
