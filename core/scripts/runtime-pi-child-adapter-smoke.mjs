import assert from "node:assert/strict";
import {
  AGENT_RUNTIME_INVOCATION_KIND,
  AGENT_RUNTIME_OUTCOME,
  AgentRuntimeConfiguration,
  AgentRuntimeExecutionLimits,
  AgentRuntimePolicyReferences,
  ApplicationConfiguration,
  BaseContextCompiler,
  EffectiveModelExecutionResolver,
  InMemoryPendingNudgeStore,
  NudgeManager,
  NudgeProviderCallCoordinator,
  NudgeRenderer,
  NudgeSelector,
  NudgeTemplateRegistry,
  TURN_STATUS,
  TurnController,
  createDefaultApplicationConfiguration,
} from "../dist/index.js";
import {
  PiRuntimeChildAdapterFactory,
} from "../dist/node/index.js";

class MemoryApplicationStore {
  constructor(configuration) {
    this.configuration = configuration;
  }

  async load() {
    return this.configuration;
  }

  async save(configuration) {
    this.configuration = configuration;
  }
}

class MemoryCredentialStatusReader {
  constructor(statuses = {}) {
    this.statuses = new Map(Object.entries(statuses));
  }

  async getStatus(reference) {
    return this.statuses.get(reference.id) ?? "missing";
  }
}

class RecordingSink {
  events = [];
  nextSequence = 2;

  async append(event) {
    this.events.push(event);
    return Object.freeze({
      status: "recorded",
      conversationId: event.conversationId,
      eventId: event.id,
      sequence: this.nextSequence++,
      recordedAt: "2026-08-04T07:00:00.000Z",
    });
  }
}

class IncrementingEventIdFactory {
  count = 0;

  create(input) {
    this.count += 1;
    return `evt-pi-child-${input.scope}-${input.ordinal}-${this.count}`;
  }
}

const conversationId = "conversation-pi-child-adapter";
const forbidden = [
  "FORBIDDEN_PI_CHILD_PROMPT",
  "FORBIDDEN_PI_CHILD_SYSTEM_PROMPT",
  "/private/workdir",
];
const records = [];
const logger = createLogger(records);
const eventSink = new RecordingSink();
const eventIdFactory = new IncrementingEventIdFactory();
const lifecycleController = new TurnController({
  conversationId,
  eventIdFactory,
  eventSink,
  runIdGenerator: Object.freeze({ generate: () => "run-pi-child-adapter" }),
  turnIdGenerator: Object.freeze({ generate: () => "turn-pi-child-adapter" }),
  clock: Object.freeze({ now: () => "2026-08-04T07:00:00.000Z" }),
  logger,
});

const resolver = new EffectiveModelExecutionResolver({
  credentials: new MemoryCredentialStatusReader({
    "credential:pi-child": "configured",
  }),
  supportedApis: ["openai-responses"],
});
const factory = new PiRuntimeChildAdapterFactory({
  application: new MemoryApplicationStore(createApplication()),
  credentials: fakeCredentials(),
  resolver,
  providerExecutionFactory: {
    create: () => async () => completedStream(assistantMessage("stop")),
  },
  logger,
});
const adapter = await factory.create({
  configuration: createConfiguration(conversationId),
  lifecycleController,
  nudgeProviderCalls: createNudgeCoordinator(),
});
const compiler = new BaseContextCompiler({ logger });
await lifecycleController.beginRun({
  inputEvent: {
    id: "input-pi-child-adapter",
    eventType: "user.message",
    sequence: 1,
  },
  correlationId: "correlation-pi-child-adapter",
});
await lifecycleController.transitionRun(
  { current: "running", reason: "execution_started" },
  { correlationId: "correlation-pi-child-adapter" },
);
const context = await compiler.compile({
  conversationId,
  runId: "run-pi-child-adapter",
  systemPrompt: "FORBIDDEN_PI_CHILD_SYSTEM_PROMPT",
  messages: [],
});
const result = await adapter.stream({
  conversationId: context.conversationId,
  runId: context.runId,
  context,
  invocation: {
    kind: AGENT_RUNTIME_INVOCATION_KIND.prompt,
    messages: [
      userMessage("message-pi-child-adapter", conversationId, "FORBIDDEN_PI_CHILD_PROMPT"),
    ],
  },
});
assert.equal(result.outcome, AGENT_RUNTIME_OUTCOME.completed);
assert.equal(lifecycleController.getTurnSnapshot()?.status, TURN_STATUS.completed);

const serializedLogs = JSON.stringify(records);
assert.ok(
  records.some((record) =>
    record.includes('"pi_runtime_child.adapter_created"'),
  ),
  "adapter created log missing",
);
for (const token of forbidden) {
  assert.equal(serializedLogs.includes(token), false);
}

const failingFactory = new PiRuntimeChildAdapterFactory({
  application: new MemoryApplicationStore(
    createDefaultApplicationConfiguration().toSnapshot(),
  ),
  credentials: fakeCredentials(),
  resolver,
  providerExecutionFactory: {
    create: () => async () => completedStream(assistantMessage("stop")),
  },
  logger,
});
await assert.rejects(
  failingFactory.create({
    configuration: createConfiguration(conversationId),
    lifecycleController,
  }),
);
assert.ok(
  records.some((record) => record.includes('"pi_runtime_child.adapter_failed"')),
  "adapter failed log missing",
);
assert.equal(
  records.some((record) =>
    record.includes("Effective Model execution is not ready"),
  ),
  false,
);
console.log("Runtime Pi child adapter smoke passed");

function createConfiguration(cid) {
  const assembly = Object.freeze({
    agentType: "novel_agent",
    definitionVersion: "1.0.0",
    manifest: Object.freeze({ runtimePolicyId: "default" }),
    systemPrompt: Object.freeze({
      content: "FORBIDDEN_PI_CHILD_SYSTEM_PROMPT",
      digest: `sha256:${"a".repeat(64)}`,
    }),
    toolView: Object.freeze({ listAllowed() { return []; } }),
    toSnapshot() {
      return Object.freeze({});
    },
  });
  return new AgentRuntimeConfiguration({
    conversationId: cid,
    assembly,
    policies: new AgentRuntimePolicyReferences({
      runtimePolicyId: "default",
      contextPolicyId: "default",
      nudgePolicyId: "default",
    }),
    limits: new AgentRuntimeExecutionLimits({
      maximumTurns: 20,
      maximumProviderCallsPerTurn: 2,
      maximumToolCallsPerTurn: 16,
      providerCallTimeoutMs: 60_000,
      toolExecutionTimeoutMs: 30_000,
    }),
  });
}

function createApplication() {
  const defaults = createDefaultApplicationConfiguration().toSnapshot();
  return new ApplicationConfiguration({
    ...defaults,
    modelConnections: [
      {
        id: "connection.pi-child",
        displayName: "Connection",
        providerKind: "openai",
        enabled: true,
        credentialRef: "credential:pi-child",
        credentialConfigured: false,
        publicHeaders: {},
        secretHeaderCredentialRefs: {},
      },
    ],
    modelProfiles: [
      {
        id: "profile.pi-child",
        displayName: "Profile",
        connectionId: "connection.pi-child",
        api: "openai-responses",
        modelId: "model-pi-child",
        parameters: { stopSequences: [], providerOptions: {} },
        capabilityOverrides: { toolCalling: true },
        fallbackProfileIds: [],
      },
    ],
    defaultModelProfileId: "profile.pi-child",
  });
}

function fakeCredentials() {
  return {
    async use(reference, operation) {
      return operation(`secret-${reference}`);
    },
    async getStatus() {
      return "configured";
    },
  };
}

function createNudgeCoordinator() {
  const templates = new NudgeTemplateRegistry();
  const manager = new NudgeManager({
    store: new InMemoryPendingNudgeStore(),
    selector: new NudgeSelector(),
    renderer: new NudgeRenderer({ templates }),
    leaseIdFactory: { create: () => "lease:pi-child-adapter" },
  });
  return new NudgeProviderCallCoordinator({
    manager,
    privateStateCommitter: { commit: async () => undefined },
    eventSink,
    eventIdFactory: {
      create: (input) => `nudge-event:${input.nudgeId}`,
    },
  });
}

function userMessage(id, cid, text) {
  return Object.freeze({
    id,
    conversationId: cid,
    role: "user",
    messageType: "user.message",
    schemaVersion: 1,
    timestamp: "2026-08-04T07:00:00.000Z",
    payload: Object.freeze({
      content: Object.freeze([Object.freeze({ type: "text", text })]),
    }),
  });
}

function assistantMessage(stopReason = "stop") {
  return {
    role: "assistant",
    content: [{ type: "text", text: "assistant response" }],
    api: "openai-completions",
    provider: "openai",
    model: "model-pi-child",
    usage: emptyUsage(),
    stopReason,
    timestamp: Date.parse("2026-08-04T07:00:01.000Z"),
  };
}

function emptyUsage() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function completedStream(finalMessage) {
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: "start", partial: finalMessage };
      yield { type: "done", reason: finalMessage.stopReason, message: finalMessage };
    },
    result: async () => finalMessage,
  };
}

function createLogger(records) {
  const logger = {
    debug: (event, fields = {}) => records.push(JSON.stringify({ event, fields })),
    info: (event, fields = {}) => records.push(JSON.stringify({ event, fields })),
    warn: (event, fields = {}) => records.push(JSON.stringify({ event, fields })),
    error: (event, fields = {}) => records.push(JSON.stringify({ event, fields })),
    child: () => logger,
  };
  return logger;
}
