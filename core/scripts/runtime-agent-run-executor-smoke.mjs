import assert from "node:assert/strict";
import {
  AGENT_RUNTIME_OUTCOME,
  AGENT_RUNTIME_RUN_EXECUTION_FAILURE,
  AgentRuntimeRunExecutor,
  AgentRuntimeRunExecutorError,
  BaseContextCompiler,
  EXECUTION_CANCELLATION_REASON,
  INPUT_EVENT_TYPE,
  RUN_STATE_CHANGE_REASON,
  RUN_STATUS,
  TurnController,
  TurnControllerStateError,
} from "../dist/index.js";

const conversationId = "conversation-agent-run-executor";
const timestamp = "2026-08-01T21:00:00.000Z";
const forbidden = [
  "FORBIDDEN_RUN_SYSTEM_PROMPT",
  "FORBIDDEN_RUN_CONTEXT_TEXT",
  "FORBIDDEN_RUN_PROMPT_TEXT",
  "FORBIDDEN_RUN_SOURCE_ERROR",
  "FORBIDDEN_RUN_COMPILER_ERROR",
  "FORBIDDEN_RUN_ADAPTER_ERROR",
  "FORBIDDEN_RUN_PATH",
];

class IncrementingEventIdFactory {
  count = 0;

  create(input) {
    this.count += 1;
    return `evt-agent-run-${input.scope}-${input.ordinal}-${this.count}`;
  }
}

class RecordingSink {
  events = [];
  failNext = false;

  async append(event) {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("FORBIDDEN_RUN_PATH");
    }
    this.events.push(event);
    return Object.freeze({
      status: "recorded",
      conversationId: event.conversationId,
      eventId: event.id,
      sequence: this.events.length,
      recordedAt: timestamp,
    });
  }
}

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

function persistedUserInput(sequence) {
  return {
    id: `input-agent-run-${sequence}`,
    conversationId,
    eventType: INPUT_EVENT_TYPE.userMessage,
    schemaVersion: 1,
    priority: 500,
    timestamp,
    correlationId: `correlation-agent-run-${sequence}`,
    payload: { text: "FORBIDDEN_RUN_PROMPT_TEXT" },
    direction: "input",
    sequence,
    recordedAt: timestamp,
  };
}

function runtimeUserMessage(id, text) {
  return {
    id,
    conversationId,
    role: "user",
    messageType: "user.message",
    schemaVersion: 1,
    timestamp,
    payload: { content: [{ type: "text", text }] },
  };
}

async function createRunningController(runId, input) {
  const sink = new RecordingSink();
  const controller = new TurnController({
    conversationId,
    eventIdFactory: new IncrementingEventIdFactory(),
    eventSink: sink,
    runIdGenerator: Object.freeze({ generate: () => runId }),
    clock: Object.freeze({ now: () => timestamp }),
  });
  await controller.beginRun({
    inputEvent: {
      id: input.id,
      eventType: input.eventType,
      sequence: input.sequence,
    },
    correlationId: input.correlationId,
  });
  await controller.transitionRun(
    {
      current: RUN_STATUS.running,
      reason: RUN_STATE_CHANGE_REASON.executionStarted,
    },
    { correlationId: input.correlationId, causationId: input.id },
  );
  return { sink, controller };
}

function preparation(runId) {
  return {
    conversationId,
    runId,
    systemPrompt: "FORBIDDEN_RUN_SYSTEM_PROMPT",
    contextMessages: [
      runtimeUserMessage("message-agent-run-context", "FORBIDDEN_RUN_CONTEXT_TEXT"),
    ],
    invocation: {
      kind: "prompt",
      messages: [
        runtimeUserMessage("message-agent-run-prompt", "FORBIDDEN_RUN_PROMPT_TEXT"),
      ],
    },
  };
}

function createExecutor(options) {
  return new AgentRuntimeRunExecutor({
    conversationId,
    preparationSource: options.preparationSource,
    contextCompiler: options.contextCompiler ?? new BaseContextCompiler(),
    agentAdapter: options.agentAdapter,
    lifecycleController: options.controller,
    logger: new CollectingLogger(options.logs),
  });
}

const completedInput = persistedUserInput(1);
const completedRunId = "run-agent-executor-completed";
const completed = await createRunningController(completedRunId, completedInput);
const completedLogs = [];
const mutablePreparation = preparation(completedRunId);
let adapterRequest;
const completedExecutor = createExecutor({
  ...completed,
  logs: completedLogs,
  preparationSource: {
    prepare: async () => mutablePreparation,
  },
  contextCompiler: {
    compile: async (request) => {
      mutablePreparation.systemPrompt = "mutated-system-prompt";
      mutablePreparation.contextMessages[0].payload.content[0].text = "mutated-context";
      mutablePreparation.invocation.messages[0].payload.content[0].text = "mutated-prompt";
      return new BaseContextCompiler().compile(request);
    },
  },
  agentAdapter: {
    stream: async (request) => {
      adapterRequest = request;
      return {
        conversationId,
        runId: completedRunId,
        outcome: AGENT_RUNTIME_OUTCOME.completed,
      };
    },
    cancel: async () => undefined,
  },
});
await completedExecutor.execute({
  conversationId,
  runId: completedRunId,
  input: completedInput,
});
assert.equal(completed.controller.getRunSnapshot().status, RUN_STATUS.completed);
assert.equal(adapterRequest.context.systemPrompt, "FORBIDDEN_RUN_SYSTEM_PROMPT");
assert.equal(
  adapterRequest.context.messages[0].payload.content[0].text,
  "FORBIDDEN_RUN_CONTEXT_TEXT",
);
assert.equal(
  adapterRequest.invocation.messages[0].payload.content[0].text,
  "FORBIDDEN_RUN_PROMPT_TEXT",
);
assert.equal(Object.isFrozen(adapterRequest.context), true);
assert.equal(Object.isFrozen(adapterRequest.context.messages), true);
assert.equal(Object.isFrozen(adapterRequest.context.messages[0].payload), true);
assert.equal(completed.sink.events.length, 3);
const completedSnapshot = completed.sink.events[2].getSnapshot();
assert.equal(completedSnapshot.correlationId, completedInput.correlationId);
assert.equal(completedSnapshot.causationId, completedInput.id);
assert.equal(completedSnapshot.payload.current, RUN_STATUS.completed);
assert.equal(
  (await completed.controller.waitForRunTerminal(completedRunId)).status,
  RUN_STATUS.completed,
);

const failedInput = persistedUserInput(2);
const failedRunId = "run-agent-executor-failed";
const failed = await createRunningController(failedRunId, failedInput);
const failedExecutor = createExecutor({
  ...failed,
  logs: [],
  preparationSource: { prepare: async () => preparation(failedRunId) },
  agentAdapter: {
    stream: async () => ({
      conversationId,
      runId: failedRunId,
      outcome: AGENT_RUNTIME_OUTCOME.failed,
    }),
    cancel: async () => undefined,
  },
});
await failedExecutor.execute({ conversationId, runId: failedRunId, input: failedInput });
assert.equal(failed.controller.getRunSnapshot().status, RUN_STATUS.failed);
assert.equal(failed.sink.events[2].getPayload().toObject().reason, "execution_failed");

const stoppingInput = persistedUserInput(3);
const stoppingRunId = "run-agent-executor-stopping";
const stopping = await createRunningController(stoppingRunId, stoppingInput);
const stoppingExecutor = createExecutor({
  ...stopping,
  logs: [],
  preparationSource: { prepare: async () => preparation(stoppingRunId) },
  agentAdapter: {
    stream: async () => {
      await stopping.controller.transitionRun({
        current: RUN_STATUS.stopping,
        reason: RUN_STATE_CHANGE_REASON.stopRequested,
      });
      void Promise.resolve().then(() =>
        stopping.controller.transitionRun({
          current: RUN_STATUS.cancelled,
          reason: RUN_STATE_CHANGE_REASON.cancellationCompleted,
          cancellationReason: EXECUTION_CANCELLATION_REASON.stop,
        }),
      );
      return {
        conversationId,
        runId: stoppingRunId,
        outcome: AGENT_RUNTIME_OUTCOME.cancelled,
      };
    },
    cancel: async () => undefined,
  },
});
await stoppingExecutor.execute({
  conversationId,
  runId: stoppingRunId,
  input: stoppingInput,
});
assert.equal(stopping.controller.getRunSnapshot().status, RUN_STATUS.cancelled);

const terminalRaceInput = persistedUserInput(31);
const terminalRaceRunId = "run-agent-executor-terminal-race";
const terminalRace = await createRunningController(terminalRaceRunId, terminalRaceInput);
const terminalRaceLifecycle = {
  getRunSnapshot: () => terminalRace.controller.getRunSnapshot(),
  waitForRunTerminal: (runId) => terminalRace.controller.waitForRunTerminal(runId),
  transitionRun: async () => {
    await terminalRace.controller.transitionRun({
      current: RUN_STATUS.stopping,
      reason: RUN_STATE_CHANGE_REASON.stopRequested,
    });
    void Promise.resolve().then(() =>
      terminalRace.controller.transitionRun({
        current: RUN_STATUS.cancelled,
        reason: RUN_STATE_CHANGE_REASON.cancellationCompleted,
        cancellationReason: EXECUTION_CANCELLATION_REASON.stop,
      }),
    );
    throw new Error("normal terminal transition lost Stop race");
  },
};
const terminalRaceExecutor = new AgentRuntimeRunExecutor({
  conversationId,
  preparationSource: { prepare: async () => preparation(terminalRaceRunId) },
  contextCompiler: new BaseContextCompiler(),
  agentAdapter: {
    stream: async () => ({
      conversationId,
      runId: terminalRaceRunId,
      outcome: AGENT_RUNTIME_OUTCOME.completed,
    }),
    cancel: async () => undefined,
  },
  lifecycleController: terminalRaceLifecycle,
});
await terminalRaceExecutor.execute({
  conversationId,
  runId: terminalRaceRunId,
  input: terminalRaceInput,
});
assert.equal(terminalRace.controller.getRunSnapshot().status, RUN_STATUS.cancelled);

const preparingStopInput = persistedUserInput(32);
const preparingStopRunId = "run-agent-executor-preparing-stop";
const preparingStop = await createRunningController(preparingStopRunId, preparingStopInput);
let preparingAdapterCalled = false;
const preparingStopExecutor = createExecutor({
  ...preparingStop,
  logs: [],
  preparationSource: { prepare: async () => preparation(preparingStopRunId) },
  contextCompiler: {
    compile: async (request) => {
      await preparingStop.controller.transitionRun({
        current: RUN_STATUS.stopping,
        reason: RUN_STATE_CHANGE_REASON.stopRequested,
      });
      void Promise.resolve().then(() =>
        preparingStop.controller.transitionRun({
          current: RUN_STATUS.cancelled,
          reason: RUN_STATE_CHANGE_REASON.cancellationCompleted,
          cancellationReason: EXECUTION_CANCELLATION_REASON.stop,
        }),
      );
      return new BaseContextCompiler().compile(request);
    },
  },
  agentAdapter: {
    stream: async () => {
      preparingAdapterCalled = true;
      return {
        conversationId,
        runId: preparingStopRunId,
        outcome: AGENT_RUNTIME_OUTCOME.completed,
      };
    },
    cancel: async () => undefined,
  },
});
await preparingStopExecutor.execute({
  conversationId,
  runId: preparingStopRunId,
  input: preparingStopInput,
});
assert.equal(preparingAdapterCalled, false);
assert.equal(preparingStop.controller.getRunSnapshot().status, RUN_STATUS.cancelled);

const cancellationFailureInput = persistedUserInput(33);
const cancellationFailureRunId = "run-agent-executor-cancellation-failure";
const cancellationFailure = await createRunningController(
  cancellationFailureRunId,
  cancellationFailureInput,
);
const cancellationFailureExecutor = createExecutor({
  ...cancellationFailure,
  logs: [],
  preparationSource: {
    prepare: async () => preparation(cancellationFailureRunId),
  },
  agentAdapter: {
    stream: async () => {
      await cancellationFailure.controller.transitionRun({
        current: RUN_STATUS.stopping,
        reason: RUN_STATE_CHANGE_REASON.stopRequested,
      });
      cancellationFailure.controller.failRunTerminalWait(cancellationFailureRunId);
      return {
        conversationId,
        runId: cancellationFailureRunId,
        outcome: AGENT_RUNTIME_OUTCOME.cancelled,
      };
    },
    cancel: async () => undefined,
  },
});
await assert.rejects(
  () =>
    cancellationFailureExecutor.execute({
      conversationId,
      runId: cancellationFailureRunId,
      input: cancellationFailureInput,
    }),
  failure(AGENT_RUNTIME_RUN_EXECUTION_FAILURE.cancellationSettlementFailed),
);

const invalidCancellationInput = persistedUserInput(4);
const invalidCancellationRunId = "run-agent-executor-invalid-cancel";
const invalidCancellation = await createRunningController(
  invalidCancellationRunId,
  invalidCancellationInput,
);
const invalidCancellationExecutor = createExecutor({
  ...invalidCancellation,
  logs: [],
  preparationSource: {
    prepare: async () => preparation(invalidCancellationRunId),
  },
  agentAdapter: {
    stream: async () => ({
      conversationId,
      runId: invalidCancellationRunId,
      outcome: AGENT_RUNTIME_OUTCOME.cancelled,
    }),
    cancel: async () => undefined,
  },
});
await assert.rejects(
  () =>
    invalidCancellationExecutor.execute({
      conversationId,
      runId: invalidCancellationRunId,
      input: invalidCancellationInput,
    }),
  failure(AGENT_RUNTIME_RUN_EXECUTION_FAILURE.invalidCancellationState),
);
assert.equal(invalidCancellation.controller.getRunSnapshot().status, RUN_STATUS.running);

const invalidPreparationInput = persistedUserInput(5);
const invalidPreparationRunId = "run-agent-executor-invalid-preparation";
const invalidPreparation = await createRunningController(
  invalidPreparationRunId,
  invalidPreparationInput,
);
const duplicateMessage = runtimeUserMessage("message-agent-run-duplicate", "safe");
const invalidPreparationExecutor = createExecutor({
  ...invalidPreparation,
  logs: [],
  preparationSource: {
    prepare: async () => ({
      conversationId,
      runId: invalidPreparationRunId,
      systemPrompt: "safe",
      contextMessages: [duplicateMessage],
      invocation: { kind: "prompt", messages: [duplicateMessage] },
    }),
  },
  agentAdapter: {
    stream: async () => assert.fail("invalid preparation reached adapter"),
    cancel: async () => undefined,
  },
});
await assert.rejects(
  () =>
    invalidPreparationExecutor.execute({
      conversationId,
      runId: invalidPreparationRunId,
      input: invalidPreparationInput,
    }),
  failure(AGENT_RUNTIME_RUN_EXECUTION_FAILURE.invalidPreparation),
);

const invalidCompiledInput = persistedUserInput(51);
const invalidCompiledRunId = "run-agent-executor-invalid-compiled";
const invalidCompiled = await createRunningController(
  invalidCompiledRunId,
  invalidCompiledInput,
);
const invalidCompiledPreparation = preparation(invalidCompiledRunId);
const invalidCompiledExecutor = createExecutor({
  ...invalidCompiled,
  logs: [],
  preparationSource: { prepare: async () => invalidCompiledPreparation },
  contextCompiler: {
    compile: async () => ({
      conversationId,
      runId: invalidCompiledRunId,
      systemPrompt: "safe",
      messages: [invalidCompiledPreparation.invocation.messages[0]],
    }),
  },
  agentAdapter: {
    stream: async () => assert.fail("invalid compiled context reached adapter"),
    cancel: async () => undefined,
  },
});
await assert.rejects(
  () =>
    invalidCompiledExecutor.execute({
      conversationId,
      runId: invalidCompiledRunId,
      input: invalidCompiledInput,
    }),
  failure(AGENT_RUNTIME_RUN_EXECUTION_FAILURE.invalidCompiledContext),
);

const invalidAdapterInput = persistedUserInput(52);
const invalidAdapterRunId = "run-agent-executor-invalid-adapter";
const invalidAdapter = await createRunningController(invalidAdapterRunId, invalidAdapterInput);
const invalidAdapterExecutor = createExecutor({
  ...invalidAdapter,
  logs: [],
  preparationSource: { prepare: async () => preparation(invalidAdapterRunId) },
  agentAdapter: {
    stream: async () => ({
      conversationId,
      runId: "wrong-run",
      outcome: AGENT_RUNTIME_OUTCOME.completed,
    }),
    cancel: async () => undefined,
  },
});
await assert.rejects(
  () =>
    invalidAdapterExecutor.execute({
      conversationId,
      runId: invalidAdapterRunId,
      input: invalidAdapterInput,
    }),
  failure(AGENT_RUNTIME_RUN_EXECUTION_FAILURE.invalidAdapterResult),
);

const invalidCommitInput = persistedUserInput(53);
const invalidCommitRunId = "run-agent-executor-invalid-commit";
const invalidCommit = await createRunningController(invalidCommitRunId, invalidCommitInput);
const invalidCommitExecutor = new AgentRuntimeRunExecutor({
  conversationId,
  preparationSource: { prepare: async () => preparation(invalidCommitRunId) },
  contextCompiler: new BaseContextCompiler(),
  agentAdapter: {
    stream: async () => ({
      conversationId,
      runId: invalidCommitRunId,
      outcome: AGENT_RUNTIME_OUTCOME.completed,
    }),
    cancel: async () => undefined,
  },
  lifecycleController: {
    getRunSnapshot: () => invalidCommit.controller.getRunSnapshot(),
    transitionRun: async () => undefined,
  },
});
await assert.rejects(
  () =>
    invalidCommitExecutor.execute({
      conversationId,
      runId: invalidCommitRunId,
      input: invalidCommitInput,
    }),
  failure(AGENT_RUNTIME_RUN_EXECUTION_FAILURE.invalidTerminalCommit),
);

const compilerFailureInput = persistedUserInput(6);
const compilerFailureRunId = "run-agent-executor-compiler-failure";
const compilerFailure = await createRunningController(
  compilerFailureRunId,
  compilerFailureInput,
);
const compilerFailureLogs = [];
const compilerFailureExecutor = createExecutor({
  ...compilerFailure,
  logs: compilerFailureLogs,
  preparationSource: {
    prepare: async () => preparation(compilerFailureRunId),
  },
  contextCompiler: {
    compile: async () => {
      throw new Error("FORBIDDEN_RUN_COMPILER_ERROR FORBIDDEN_RUN_PATH");
    },
  },
  agentAdapter: {
    stream: async () => assert.fail("compiler failure reached adapter"),
    cancel: async () => undefined,
  },
});
await assert.rejects(
  () =>
    compilerFailureExecutor.execute({
      conversationId,
      runId: compilerFailureRunId,
      input: compilerFailureInput,
    }),
  failure(AGENT_RUNTIME_RUN_EXECUTION_FAILURE.contextCompileFailed),
);
assert.equal(compilerFailure.controller.getRunSnapshot().status, RUN_STATUS.running);

const adapterFailureInput = persistedUserInput(7);
const adapterFailureRunId = "run-agent-executor-adapter-failure";
const adapterFailure = await createRunningController(adapterFailureRunId, adapterFailureInput);
const adapterFailureLogs = [];
const adapterFailureExecutor = createExecutor({
  ...adapterFailure,
  logs: adapterFailureLogs,
  preparationSource: { prepare: async () => preparation(adapterFailureRunId) },
  agentAdapter: {
    stream: async () => {
      throw new Error("FORBIDDEN_RUN_ADAPTER_ERROR FORBIDDEN_RUN_PATH");
    },
    cancel: async () => undefined,
  },
});
await assert.rejects(
  () =>
    adapterFailureExecutor.execute({
      conversationId,
      runId: adapterFailureRunId,
      input: adapterFailureInput,
    }),
  failure(AGENT_RUNTIME_RUN_EXECUTION_FAILURE.adapterFailed),
);
assert.equal(adapterFailure.controller.getRunSnapshot().status, RUN_STATUS.running);

const concurrentInput = persistedUserInput(8);
const concurrentRunId = "run-agent-executor-concurrent";
const concurrent = await createRunningController(concurrentRunId, concurrentInput);
let releasePreparation;
const preparationBarrier = new Promise((resolve) => {
  releasePreparation = resolve;
});
const concurrentExecutor = createExecutor({
  ...concurrent,
  logs: [],
  preparationSource: {
    prepare: async () => {
      await preparationBarrier;
      return preparation(concurrentRunId);
    },
  },
  agentAdapter: {
    stream: async () => ({
      conversationId,
      runId: concurrentRunId,
      outcome: AGENT_RUNTIME_OUTCOME.completed,
    }),
    cancel: async () => undefined,
  },
});
const firstExecution = concurrentExecutor.execute({
  conversationId,
  runId: concurrentRunId,
  input: concurrentInput,
});
await assert.rejects(
  () =>
    concurrentExecutor.execute({
      conversationId,
      runId: concurrentRunId,
      input: concurrentInput,
    }),
  failure(AGENT_RUNTIME_RUN_EXECUTION_FAILURE.activeExecution),
);
releasePreparation();
await firstExecution;

const terminalWaitFailureInput = persistedUserInput(81);
const terminalWaitFailureRunId = "run-agent-executor-terminal-wait-failure";
const terminalWaitFailure = await createRunningController(
  terminalWaitFailureRunId,
  terminalWaitFailureInput,
);
const terminalWaitPromise = terminalWaitFailure.controller.waitForRunTerminal(
  terminalWaitFailureRunId,
);
terminalWaitFailure.sink.failNext = true;
await assert.rejects(
  () =>
    terminalWaitFailure.controller.transitionRun({
      current: RUN_STATUS.failed,
      reason: RUN_STATE_CHANGE_REASON.executionFailed,
    }),
);
await assert.rejects(
  () => terminalWaitPromise,
  (error) =>
    error instanceof TurnControllerStateError &&
    error.reason === "run_terminal_wait_failed",
);
await assert.rejects(
  () => terminalWaitFailure.controller.waitForRunTerminal(terminalWaitFailureRunId),
  (error) =>
    error instanceof TurnControllerStateError &&
    error.reason === "run_terminal_wait_failed",
);

const allLogs = [...completedLogs, ...compilerFailureLogs, ...adapterFailureLogs];
const serializedLogs = JSON.stringify(allLogs);
for (const token of forbidden) assert.equal(serializedLogs.includes(token), false);
assert.equal(serializedLogs.includes('"payload"'), false);
assert.equal(
  completedLogs.some((record) => record.event === "runtime.agent_run.execution_completed"),
  true,
);
assert.equal(
  compilerFailureLogs.some(
    (record) =>
      record.event === "runtime.agent_run.execution_failed" &&
      record.failure === AGENT_RUNTIME_RUN_EXECUTION_FAILURE.contextCompileFailed,
  ),
  true,
);

function failure(expected) {
  return (error) =>
    error instanceof AgentRuntimeRunExecutorError && error.failure === expected;
}

console.log("Task 3E-F Agent Runtime Run Executor smoke passed");
