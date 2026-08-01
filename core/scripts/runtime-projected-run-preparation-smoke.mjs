import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AgentAssistantMessageCompletedOutputEvent,
  CoreConversationRuntimeMessageProjector,
  INPUT_EVENT_TYPE,
  PROJECTED_RUN_PREPARATION_FAILURE,
  ProjectedUserMessageRunPreparationError,
  ProjectedUserMessageRunPreparationSource,
  UserMessageInputEvent,
} from "../dist/index.js";
import {
  NodeWorkspaceStoreLocator,
  SqliteWorkspaceStore,
} from "../dist/node/index.js";

const timestamp = "2026-08-01T22:00:00.000Z";
const conversationId = "conversation-projected-preparation";
const forbidden = [
  "FORBIDDEN_PREPARATION_SYSTEM_PROMPT",
  "FORBIDDEN_PREPARATION_CONTEXT_TEXT",
  "FORBIDDEN_PREPARATION_CURRENT_TEXT",
  "FORBIDDEN_PREPARATION_LATER_TEXT",
  "FORBIDDEN_PREPARATION_THINKING",
  "FORBIDDEN_PREPARATION_ERROR",
];

class CollectingLogger {
  constructor(records = [], bindings = {}) {
    this.records = records;
    this.bindings = bindings;
  }

  debug(event, fields = {}) {
    this.record("debug", event, fields);
  }

  info(event, fields = {}) {
    this.record("info", event, fields);
  }

  warn(event, fields = {}) {
    this.record("warn", event, fields);
  }

  error(event, fields = {}) {
    this.record("error", event, fields);
  }

  child(bindings) {
    return new CollectingLogger(this.records, { ...this.bindings, ...bindings });
  }

  record(level, event, fields) {
    this.records.push({ level, event, ...this.bindings, ...fields });
  }
}

function persistedInput(sequence, id = `input-preparation-${sequence}`) {
  return {
    id,
    conversationId,
    eventType: INPUT_EVENT_TYPE.userMessage,
    schemaVersion: 1,
    priority: 500,
    timestamp,
    payload: { text: "FORBIDDEN_PREPARATION_CURRENT_TEXT" },
    direction: "input",
    sequence,
    recordedAt: timestamp,
  };
}

function runtimeMessage(id, role, messageType, text) {
  return {
    id,
    conversationId,
    role,
    messageType,
    schemaVersion: 1,
    timestamp,
    payload: { content: [{ type: "text", text }] },
  };
}

function messageRecord(messageIndex, source, message) {
  return {
    recordType: "message",
    conversationId,
    messageIndex,
    source,
    message,
  };
}

function fakeProjection(projectedThroughSequence, messageCount) {
  return {
    synchronize: async () => ({
      workspaceId: "workspace-projected-preparation",
      projectorId: "core.conversation-message",
      projectorVersion: "1",
      conversationId,
      operations: [],
      previousSequence: projectedThroughSequence,
      projectedThroughSequence,
      journalHighWatermark: projectedThroughSequence,
      processedEventCount: 0,
      appendedMessageCount: messageCount,
    }),
  };
}

function fakeMessageStore(records, projectedThroughSequence, calls) {
  return {
    list: async (query) => {
      calls.push({ ...query });
      const highWatermarkMessageIndex =
        query.highWatermarkMessageIndex ?? records.length;
      const matching = records.filter(
        (record) =>
          record.messageIndex > (query.afterMessageIndex ?? 0) &&
          record.messageIndex <= highWatermarkMessageIndex,
      );
      const items = matching.slice(0, query.limit);
      const hasMore = matching.length > items.length;
      return {
        conversationId,
        items,
        highWatermarkMessageIndex,
        projectedThroughSequence,
        hasMore,
        ...(hasMore
          ? { nextAfterMessageIndex: items.at(-1).messageIndex }
          : {}),
      };
    },
  };
}

const fakeLogs = [];
const fakeListCalls = [];
const currentInput = persistedInput(2);
const fakeRecords = [
  messageRecord(
    1,
    {
      sequence: 1,
      eventId: "input-preparation-1",
      eventType: INPUT_EVENT_TYPE.userMessage,
      direction: "input",
      ordinal: 0,
    },
    runtimeMessage(
      "message-preparation-context",
      "user",
      "user.message",
      "FORBIDDEN_PREPARATION_CONTEXT_TEXT",
    ),
  ),
  messageRecord(
    2,
    {
      sequence: 2,
      eventId: currentInput.id,
      eventType: currentInput.eventType,
      direction: "input",
      ordinal: 0,
    },
    runtimeMessage(
      "message-preparation-current-assistant",
      "assistant",
      "assistant.message",
      "supplemental current context",
    ),
  ),
  messageRecord(
    3,
    {
      sequence: 2,
      eventId: currentInput.id,
      eventType: currentInput.eventType,
      direction: "input",
      ordinal: 1,
    },
    runtimeMessage(
      "message-preparation-current-user",
      "user",
      "user.message",
      "FORBIDDEN_PREPARATION_CURRENT_TEXT",
    ),
  ),
  messageRecord(
    4,
    {
      sequence: 3,
      eventId: "input-preparation-3",
      eventType: INPUT_EVENT_TYPE.userMessage,
      direction: "input",
      ordinal: 0,
    },
    runtimeMessage(
      "message-preparation-later",
      "user",
      "user.message",
      "FORBIDDEN_PREPARATION_LATER_TEXT",
    ),
  ),
];
const fakeSource = new ProjectedUserMessageRunPreparationSource({
  conversationId,
  projections: fakeProjection(3, fakeRecords.length),
  messages: fakeMessageStore(fakeRecords, 3, fakeListCalls),
  systemPromptSource: {
    resolve: async () => "FORBIDDEN_PREPARATION_SYSTEM_PROMPT",
  },
  pageSize: 2,
  logger: new CollectingLogger(fakeLogs),
});
const fakePreparation = await fakeSource.prepare({
  conversationId,
  runId: "run-projected-preparation-fake",
  input: currentInput,
});
assert.equal(fakePreparation.contextMessages.length, 1);
assert.equal(fakePreparation.invocation.messages.length, 2);
assert.equal(
  fakePreparation.invocation.messages[0].id,
  "message-preparation-current-assistant",
);
assert.equal(
  fakePreparation.invocation.messages[1].id,
  "message-preparation-current-user",
);
assert.equal(
  JSON.stringify(fakePreparation).includes("FORBIDDEN_PREPARATION_LATER_TEXT"),
  false,
);
assert.equal(fakeListCalls.length, 2);
assert.equal(fakeListCalls[0].highWatermarkMessageIndex, undefined);
assert.equal(fakeListCalls[1].highWatermarkMessageIndex, 4);
assert.equal(Object.isFrozen(fakePreparation), true);
assert.equal(Object.isFrozen(fakePreparation.contextMessages), true);
assert.equal(Object.isFrozen(fakePreparation.invocation), true);
assert.equal(Object.isFrozen(fakePreparation.invocation.messages), true);

const ambiguousRecords = [
  messageRecord(
    1,
    {
      sequence: 2,
      eventId: currentInput.id,
      eventType: currentInput.eventType,
      direction: "input",
      ordinal: 0,
    },
    runtimeMessage("message-ambiguous-1", "user", "user.message", "first"),
  ),
  messageRecord(
    2,
    {
      sequence: 2,
      eventId: currentInput.id,
      eventType: currentInput.eventType,
      direction: "input",
      ordinal: 1,
    },
    runtimeMessage("message-ambiguous-2", "user", "user.message", "second"),
  ),
];
const ambiguousSource = new ProjectedUserMessageRunPreparationSource({
  conversationId,
  projections: fakeProjection(2, 2),
  messages: fakeMessageStore(ambiguousRecords, 2, []),
  systemPromptSource: { resolve: async () => "safe" },
});
await assert.rejects(
  () =>
    ambiguousSource.prepare({
      conversationId,
      runId: "run-projected-preparation-ambiguous",
      input: currentInput,
    }),
  failure(PROJECTED_RUN_PREPARATION_FAILURE.currentInputMessageAmbiguous),
);

const behindSource = new ProjectedUserMessageRunPreparationSource({
  conversationId,
  projections: fakeProjection(1, 0),
  messages: fakeMessageStore([], 1, []),
  systemPromptSource: { resolve: async () => "safe" },
});
await assert.rejects(
  () =>
    behindSource.prepare({
      conversationId,
      runId: "run-projected-preparation-behind",
      input: currentInput,
    }),
  failure(PROJECTED_RUN_PREPARATION_FAILURE.projectionBehindInput),
);

const promptFailureLogs = [];
const promptFailureSource = new ProjectedUserMessageRunPreparationSource({
  conversationId,
  projections: fakeProjection(2, ambiguousRecords.length),
  messages: fakeMessageStore(ambiguousRecords, 2, []),
  systemPromptSource: {
    resolve: async () => {
      throw new Error("FORBIDDEN_PREPARATION_ERROR");
    },
  },
  logger: new CollectingLogger(promptFailureLogs),
});
await assert.rejects(
  () =>
    promptFailureSource.prepare({
      conversationId,
      runId: "run-projected-preparation-prompt-failure",
      input: currentInput,
    }),
  failure(PROJECTED_RUN_PREPARATION_FAILURE.systemPromptFailed),
);

const temporaryRoot = await mkdtemp(join(tmpdir(), "novel-projected-preparation-"));
const workspaceRoot = join(temporaryRoot, "workspace");
const storageRoot = join(temporaryRoot, "storage");
const integrationLogs = [];
const integrationLogger = new CollectingLogger(integrationLogs);

try {
  await mkdir(workspaceRoot, { recursive: true });
  const location = await new NodeWorkspaceStoreLocator({ storageRoot }).resolve(
    workspaceRoot,
  );
  const store = await SqliteWorkspaceStore.open({
    workspace: location,
    logger: integrationLogger,
  });
  await store.conversations.createConversation({
    id: conversationId,
    workspaceId: location.workspaceId,
    agent: { agentType: "novel.main", definitionVersion: "1" },
  });

  const priorReceipt = await store.journal.append({
    direction: "input",
    snapshot: new UserMessageInputEvent({
      id: "input-integration-prior",
      conversationId,
      text: "FORBIDDEN_PREPARATION_CONTEXT_TEXT",
      timestamp: "2026-08-01T22:00:00.000Z",
    }).getSnapshot(),
  });
  await store.journal.append({
    direction: "output",
    snapshot: new AgentAssistantMessageCompletedOutputEvent({
      id: "output-integration-prior-assistant",
      conversationId,
      runId: "run-integration-prior",
      turnId: "turn-integration-prior",
      assistantMessageId: "assistant-integration-prior",
      timestamp: "2026-08-01T22:00:01.000Z",
      content: [
        { type: "thinking", thinking: "FORBIDDEN_PREPARATION_THINKING" },
        { type: "text", text: "prior assistant text" },
      ],
      completionReason: "stop",
      hasToolCalls: false,
    }).getSnapshot(),
  });
  const currentReceipt = await store.journal.append({
    direction: "input",
    snapshot: new UserMessageInputEvent({
      id: "input-integration-current",
      conversationId,
      text: "FORBIDDEN_PREPARATION_CURRENT_TEXT",
      timestamp: "2026-08-01T22:00:02.000Z",
    }).getSnapshot(),
  });
  await store.journal.append({
    direction: "input",
    snapshot: new UserMessageInputEvent({
      id: "input-integration-later",
      conversationId,
      text: "FORBIDDEN_PREPARATION_LATER_TEXT",
      timestamp: "2026-08-01T22:00:03.000Z",
    }).getSnapshot(),
  });
  assert.equal(priorReceipt.sequence, 1);
  const persistedCurrent = await store.journal.getBySequence(
    conversationId,
    currentReceipt.sequence,
  );
  assert.notEqual(persistedCurrent, undefined);

  const projectionContext = store.createMessageProjectionContext({
    projector: new CoreConversationRuntimeMessageProjector({
      logger: integrationLogger,
    }),
    logger: integrationLogger,
  });
  let promptRequest;
  const integrationSource = new ProjectedUserMessageRunPreparationSource({
    conversationId,
    projections: projectionContext.projections,
    messages: projectionContext.messages,
    systemPromptSource: {
      resolve: async (request) => {
        promptRequest = request;
        return "FORBIDDEN_PREPARATION_SYSTEM_PROMPT";
      },
    },
    pageSize: 1,
    logger: integrationLogger,
  });
  const integrationPreparation = await integrationSource.prepare({
    conversationId,
    runId: "run-projected-preparation-integration",
    input: persistedCurrent,
  });
  assert.equal(integrationPreparation.contextMessages.length, 2);
  assert.deepEqual(
    integrationPreparation.contextMessages.map((message) => message.role),
    ["user", "assistant"],
  );
  assert.equal(integrationPreparation.invocation.kind, "prompt");
  assert.equal(integrationPreparation.invocation.messages.length, 1);
  assert.equal(
    integrationPreparation.invocation.messages[0].payload.content[0].text,
    "FORBIDDEN_PREPARATION_CURRENT_TEXT",
  );
  assert.equal(
    JSON.stringify(integrationPreparation).includes("FORBIDDEN_PREPARATION_LATER_TEXT"),
    false,
  );
  assert.equal(
    JSON.stringify(integrationPreparation).includes("FORBIDDEN_PREPARATION_THINKING"),
    false,
  );
  assert.equal(promptRequest.input.id, persistedCurrent.id);
  assert.notEqual(promptRequest.input, persistedCurrent);
  assert.equal(Object.isFrozen(promptRequest), true);
  assert.equal(Object.isFrozen(promptRequest.input), true);

  await projectionContext.close();
  await store.close();
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

const serializedLogs = JSON.stringify([
  ...fakeLogs,
  ...promptFailureLogs,
  ...integrationLogs,
]);
for (const token of [...forbidden, temporaryRoot]) {
  assert.equal(serializedLogs.includes(token), false);
}
assert.equal(serializedLogs.includes('"payload"'), false);
assert.equal(
  integrationLogs.some(
    (record) => record.event === "runtime.run_preparation.completed",
  ),
  true,
);

function failure(expected) {
  return (error) =>
    error instanceof ProjectedUserMessageRunPreparationError &&
    error.failure === expected;
}

console.log("Task 3E-G Projected UserMessage Run preparation smoke passed");
