/**
 * nudge 定义集中装配冒烟：definitions/ 目录 + agent enablesNudges ∩ 工具组守卫。
 * Nudge-definitions assembly smoke: centralized definitions + agent enablements ∩ tool-group guard.
 *
 * 验证 / Verifies:
 * 1. 生效集：NUDGE_DEFINITIONS + novelAgentDefinition.nudgeEnablement.enabled ∩ 工具组
 *    守卫 → 恰为 [compose_mode, compose_mode_exit, todo_idle]；未配置 nudgeEnablement 的
 *    定义 → 空集；缺组 → 跳过。
 * 2. 共享 policy 去重：compose 两定义同属 ComposeModeNudgePolicy → 引擎只注册一个实例。
 * 3. compose_mode：enter → call#1 交付 full；call#2-5 无；call#6/#11/#16/#21 稀疏；
 *    call#26 第 6 次交付再次 full（deliveryCount % 5 === 1）；exit → 一次性
 *    compose_mode_exit（once）；随后无交付。compose_mode 转为 acknowledged。
 * 4. todo_idle：连续 ≥3 次 provider call 未调用 TodoWrite → 每 run 注入一次；
 *    跨轮清空；TodoWrite 一调用即重置（写后重新计数，写后 3 个未写 call 仍触发）；
 *    once 交付 + 跨 run 重新激活（store 替换而非累积）。
 * 5. 真实 CorePiRuntimeMessageConverter 把 system.reminder（kind=compose_mode）转成
 *    Pi user 消息，内容含 <system-reminder kind="compose_mode">。
 * 6. 脱敏：nudge 内容/参数不得出现在日志或事件中。
 *
 * 注意（cooldown 语义）：NudgeSelector 为 strict > 语义（交付后抑制 N 条、第 N+1 条
 * 重交付），故 COMPOSE_MODE_COOLDOWN_TURNS=4 → 首条 #1 后每 ~5 条 provider call 一条。
 */
import assert from "node:assert/strict";
import {
  AgentCommunicationPolicy,
  AgentDefinition,
  AgentDelegationPolicy,
  AgentToolPolicy,
  InMemoryPendingNudgeStore,
  NudgeManager,
  NudgeProviderCallCoordinator,
  NudgeRenderer,
  NudgeSelector,
  NudgeTemplateRegistry,
  PENDING_NUDGE_STATE,
  PromptRecipe,
  PromptSectionItem,
  RUNTIME_POLICY_PHASE,
  RuntimeEffectCoordinator,
  RuntimeNudgePolicyEffectHandler,
  RuntimePolicyEngine,
  novelAgentDefinition,
} from "../dist/index.js";
import {
  CorePiRuntimeMessageConverter,
  PI_RUNTIME_MESSAGE_CONVERSION_PURPOSE,
} from "../dist/runtime/agent/pi/index.js";
import { NUDGE_DEFINITIONS } from "../dist/runtime/nudge/definitions/index.js";
import {
  COMPOSE_MODE_COOLDOWN_TURNS,
  COMPOSE_MODE_EXIT_NUDGE_ID,
  COMPOSE_MODE_NUDGE_ID,
  COMPOSE_MODE_TOOL_GROUP,
} from "../dist/runtime/nudge/definitions/compose.js";
import {
  TODO_IDLE_NUDGE_ID,
  TODO_IDLE_TOOL_GROUP,
} from "../dist/runtime/nudge/definitions/todo.js";

const COMPOSE_FULL_MARK = "# 设计模式（Compose Mode）";
const COMPOSE_SPARSE_MARK = "仍在设计模式";
const COMPOSE_EXIT_MARK = "# 设计模式已结束";
const TODO_IDLE_MARK = "待办列表维护提醒";
const DESIGN_FILE = "design/chapter-3.md";

const logs = [];
const logger = {
  debug: (event, fields) => logs.push({ level: "debug", event, fields }),
  info: (event, fields) => logs.push({ level: "info", event, fields }),
  warn: (event, fields) => logs.push({ level: "warn", event, fields }),
  error: (event, fields) => logs.push({ level: "error", event, fields }),
  child: () => logger,
};

const conversationId = "conversation:definitions";
const runId = "run:definitions";

// ---------------------------------------------------------------------------
// 1. 生效集：AgentDefinition.nudgeEnablement ∩ 工具组守卫。
// Effective set: AgentDefinition.nudgeEnablement ∩ tool-group guard.
// ---------------------------------------------------------------------------
const enabledNudges = novelAgentDefinition.nudgeEnablement.enabled;
assert.deepEqual(enabledNudges, [
  COMPOSE_MODE_NUDGE_ID,
  COMPOSE_MODE_EXIT_NUDGE_ID,
  TODO_IDLE_NUDGE_ID,
]);

// 未配置 nudgeEnablement 的 AgentDefinition 默认空集（不再是按 agentType 查表）。
// An AgentDefinition without nudgeEnablement defaults to the empty set (no more agentType lookup).
const defaultDefinition = new AgentDefinition({
  agentType: "smoke_default",
  definitionVersion: "1.0.0",
  label: "Default",
  description: "Minimal definition with no nudge enablement.",
  promptRecipe: new PromptRecipe([
    new PromptSectionItem("core.runtime.protocol"),
  ]),
  tools: new AgentToolPolicy({ groupIds: ["runtime.todo"] }),
  delegation: new AgentDelegationPolicy({
    mode: "disabled",
    allowedAgentTypes: [],
  }),
  communication: new AgentCommunicationPolicy("standalone"),
  runtimePolicyId: "default",
});
assert.deepEqual(defaultDefinition.nudgeEnablement.enabled, []);

function effectiveDefinitions(manifestToolGroups) {
  return NUDGE_DEFINITIONS.filter(
    (definition) =>
      enabledNudges.includes(definition.id) &&
      manifestToolGroups.has(definition.requiredToolGroup),
  );
}

// 完整 manifest：compose 工具组 + todo 工具组。
const fullEffective = effectiveDefinitions(
  new Set([COMPOSE_MODE_TOOL_GROUP, TODO_IDLE_TOOL_GROUP]),
);
assert.deepEqual(
  fullEffective.map((definition) => definition.id),
  [COMPOSE_MODE_NUDGE_ID, COMPOSE_MODE_EXIT_NUDGE_ID, TODO_IDLE_NUDGE_ID],
);

// 缺 runtime.todo 组 → todo_idle 被守卫跳过。
const composeOnly = effectiveDefinitions(new Set([COMPOSE_MODE_TOOL_GROUP]));
assert.deepEqual(
  composeOnly.map((definition) => definition.id),
  [COMPOSE_MODE_NUDGE_ID, COMPOSE_MODE_EXIT_NUDGE_ID],
);

// 2. 共享 policy 去重：compose 两定义 → 单个 ComposeModeNudgePolicy。
const seenPolicyIds = new Set();
const policies = [];
for (const definition of fullEffective) {
  const policy = definition.createPolicy();
  if (seenPolicyIds.has(policy.id)) continue;
  seenPolicyIds.add(policy.id);
  policies.push(policy);
}
assert.deepEqual(
  policies.map((policy) => policy.id),
  ["compose_mode", "todo_idle"],
);

// ---------------------------------------------------------------------------
// nudge 运行时装配（对齐 DesktopRuntimeChildCompositionFactory：模板注册 +
// policy 引擎 + effect coordinator → NudgeManager）。
// ---------------------------------------------------------------------------
function createNudgeRuntime(definitions) {
  const templates = new NudgeTemplateRegistry({ logger });
  const store = new InMemoryPendingNudgeStore({ logger });
  const manager = new NudgeManager({
    store,
    selector: new NudgeSelector({ logger }),
    renderer: new NudgeRenderer({ templates, logger }),
    leaseIdFactory: {
      create: (request) => `lease:${request.providerCallId}`,
    },
    logger,
  });
  const privateSnapshots = [];
  const publicEvents = [];
  const coordinator = new NudgeProviderCallCoordinator({
    manager,
    privateStateCommitter: {
      commit: async (snapshot) => privateSnapshots.push(snapshot),
    },
    eventSink: {
      append: async (event) => {
        const snapshot = event.getSnapshot();
        publicEvents.push(snapshot);
        return {
          status: "recorded",
          conversationId: snapshot.conversationId,
          eventId: snapshot.id,
          sequence: publicEvents.length,
          recordedAt: snapshot.timestamp,
        };
      },
    },
    eventIdFactory: {
      create: (input) =>
        `event:${input.providerCallId}:${input.nudgeId}:${input.eventType}`,
    },
    logger,
  });
  for (const definition of definitions) templates.register(definition.template);
  const deduped = [];
  const ids = new Set();
  for (const definition of definitions) {
    const policy = definition.createPolicy();
    if (ids.has(policy.id)) continue;
    ids.add(policy.id);
    deduped.push(policy);
  }
  const policyEngine = new RuntimePolicyEngine({ policies: deduped, logger });
  const effectCoordinator = new RuntimeEffectCoordinator({
    conversationId,
    nudgeLifecycleHandler: new RuntimeNudgePolicyEffectHandler(manager),
    logger,
  });
  return {
    store,
    manager,
    coordinator,
    privateSnapshots,
    publicEvents,
    policyEngine,
    effectCoordinator,
  };
}

// 单条 provider call：求值 policies → 执行效果 → 租赁 → 确认交付。
async function providerCall(runtime, ordinal, signals) {
  const providerCallId = `provider-call-${ordinal}`;
  const evaluatedAt = `2026-08-08T00:00:${String(ordinal).padStart(2, "0")}.000Z`;
  const context = {
    phase: RUNTIME_POLICY_PHASE.beforeProviderCall,
    conversationId,
    runId,
    providerCallId,
    evaluatedAt,
    runtimeSignals: { providerCallCount: ordinal, ...signals },
  };
  const state = { conversationId };
  const effects = runtime.policyEngine.evaluate(context, state);
  await runtime.effectCoordinator.execute({ context, effects });
  const prepared = await runtime.coordinator.prepare({
    conversationId,
    runId,
    providerCallId,
    targetTurnNumber: ordinal,
    requestedAt: evaluatedAt,
  });
  if (prepared !== undefined) {
    await runtime.coordinator.confirmDispatched(prepared, evaluatedAt);
  }
  return prepared;
}

// 单条 provider call（显式 run）：跨 run 场景用独立 runId，policy 实例跨 run 共享。
async function providerCallInRun(runtime, runIdValue, ordinal, signals) {
  const providerCallId = `provider-call-${runIdValue}-${ordinal}`;
  const evaluatedAt = `2026-08-08T00:00:${String(ordinal).padStart(2, "0")}.000Z`;
  const context = {
    phase: RUNTIME_POLICY_PHASE.beforeProviderCall,
    conversationId,
    runId: runIdValue,
    providerCallId,
    evaluatedAt,
    runtimeSignals: { providerCallCount: ordinal, ...signals },
  };
  const state = { conversationId };
  const effects = runtime.policyEngine.evaluate(context, state);
  await runtime.effectCoordinator.execute({ context, effects });
  const prepared = await runtime.coordinator.prepare({
    conversationId,
    runId: runIdValue,
    providerCallId,
    targetTurnNumber: ordinal,
    requestedAt: evaluatedAt,
  });
  if (prepared !== undefined) {
    await runtime.coordinator.confirmDispatched(prepared, evaluatedAt);
  }
  return prepared;
}

const composeActive = {
  compose: {
    phase: "designing",
    active: true,
    mode: "compose",
    designFilePath: DESIGN_FILE,
  },
};
const composeInactive = { compose: { phase: "idle", active: false, mode: "compose" } };

// ---------------------------------------------------------------------------
// 3. compose_mode 交付 trace。
// ---------------------------------------------------------------------------
const composeRuntime = createNudgeRuntime(fullEffective);

// call#1：enter → schedule + 首条 full（deliveryCount 1，1 % 5 === 1）。
const call1 = await providerCall(composeRuntime, 1, composeActive);
assert.ok(call1, "call#1 应交付");
assert.equal(call1.overlay.reminderKind, "compose_mode");
assert.ok(call1.overlay.content.includes(COMPOSE_FULL_MARK));
assert.ok(call1.overlay.content.includes(DESIGN_FILE));
assert.ok(
  composeRuntime.publicEvents.some(
    (event) =>
      event.eventType === "system.reminder.injected" &&
      event.payload.providerCallId === "provider-call-1",
  ),
);

// call#2-5：cooldown 抑制，无交付。
for (let ordinal = 2; ordinal <= 5; ordinal += 1) {
  assert.equal(
    await providerCall(composeRuntime, ordinal, composeActive),
    undefined,
    `call#${ordinal} 不应交付`,
  );
}

// call#6：第 2 次交付 → 稀疏（cooldownTurns=4 严格 > 语义，首条后每 ~5 条）。
for (const ordinal of [6, 11, 16, 21]) {
  const delivered = await providerCall(composeRuntime, ordinal, composeActive);
  assert.ok(delivered, `call#${ordinal} 应交付（稀疏）`);
  assert.equal(delivered.overlay.reminderKind, "compose_mode");
  assert.ok(delivered.overlay.content.includes(COMPOSE_SPARSE_MARK));
  assert.ok(!delivered.overlay.content.includes(COMPOSE_FULL_MARK));
}

// call#26：第 6 次交付 → 再次 full（6 % 5 === 1）。
const call26 = await providerCall(composeRuntime, 26, composeActive);
assert.ok(call26, "call#26 应交付（第 6 次，full）");
assert.ok(call26.overlay.content.includes(COMPOSE_FULL_MARK));

// call#27：exit → acknowledge compose_mode + 一次性 compose_mode_exit。
const exitCall = await providerCall(composeRuntime, 27, composeInactive);
assert.ok(exitCall, "call#27 应交付 exit");
assert.equal(exitCall.overlay.reminderKind, "compose_mode_exit");
assert.ok(exitCall.overlay.content.includes(COMPOSE_EXIT_MARK));

// call#28+：不再交付；compose_mode 已 acknowledge、exit 已 consumed。
assert.equal(
  await providerCall(composeRuntime, 28, composeInactive),
  undefined,
  "call#28 不应交付",
);
const composeNudges = await composeRuntime.store.list();
assert.equal(
  composeNudges.find((nudge) => nudge.id === COMPOSE_MODE_NUDGE_ID).state,
  PENDING_NUDGE_STATE.acknowledged,
);
assert.equal(
  composeNudges.find((nudge) => nudge.id === COMPOSE_MODE_EXIT_NUDGE_ID).state,
  PENDING_NUDGE_STATE.consumed,
);

// ---------------------------------------------------------------------------
// 4. todo_idle：连续 ≥3 次 provider call 未调用 TodoWrite → 每 run 注入一次；
//    跨轮清空；写即清空（写后重新计数，写后 3 个未写 call 仍触发）。
//    信号滞后建模：TodoWrite 在写入 call 的下一个 call 才被观察到
//    （lastUpdatedRunId 滞后一拍），故「写入 call 本身」显示上一写入 run。
// ---------------------------------------------------------------------------
const todoRuntime = createNudgeRuntime(fullEffective);
const todoSignal = (lastUpdatedRunId) => ({
  todos: { inProgressCount: 1, lastUpdatedRunId },
});

// run:seed：首个 TodoWrite，建立 snapshot（lastUpdatedRunId=run:seed）。
assert.equal(
  await providerCallInRun(todoRuntime, "run:seed", 1, todoSignal("run:seed")),
  undefined,
  "seed 写入 call 不提醒",
);
// run:W：call#1 执行 TodoWrite（滞后一拍）；call#2 观察到 → 写即清空，重新计数。
assert.equal(
  await providerCallInRun(todoRuntime, "run:W", 1, todoSignal("run:seed")),
  undefined,
  "run:W 写入 call（尚未观察到）不提醒",
);
assert.equal(
  await providerCallInRun(todoRuntime, "run:W", 2, todoSignal("run:W")),
  undefined,
  "run:W 观察到写入后计数1，不提醒",
);
assert.equal(
  await providerCallInRun(todoRuntime, "run:W", 3, todoSignal("run:W")),
  undefined,
  "run:W 计数2，不提醒",
);
const todoRunW = await providerCallInRun(todoRuntime, "run:W", 4, todoSignal("run:W"));
assert.ok(todoRunW, "run:W 写后第 3 个未写 call（计数3）应注入");
assert.equal(todoRunW.overlay.reminderKind, "todo_idle");
assert.ok(todoRunW.overlay.content.includes(TODO_IDLE_MARK));
// 同 run 后续 provider call 不重复（per-run 守卫）。
assert.equal(
  await providerCallInRun(todoRuntime, "run:W", 5, todoSignal("run:W")),
  undefined,
  "同 run 不重复提醒",
);
// run:X：新 run，跨轮清空 → 计数重新从 1 起，第 3 个未写 call 再次注入
//（once 交付后跨 run 重新激活，store 替换而非累积）。
assert.equal(
  await providerCallInRun(todoRuntime, "run:X", 1, todoSignal("run:W")),
  undefined,
  "run:X call#1（跨轮清空计数1）不提醒",
);
assert.equal(
  await providerCallInRun(todoRuntime, "run:X", 2, todoSignal("run:W")),
  undefined,
  "run:X call#2（计数2）不提醒",
);
const todoRunX = await providerCallInRun(todoRuntime, "run:X", 3, todoSignal("run:W"));
assert.ok(todoRunX, "run:X 第 3 个未写 call 应再次提醒");
assert.equal(todoRunX.overlay.reminderKind, "todo_idle");
// run:Y：call#1 执行 TodoWrite（滞后一拍）；写后 3 个未写 call 仍触发。
assert.equal(
  await providerCallInRun(todoRuntime, "run:Y", 1, todoSignal("run:W")),
  undefined,
  "run:Y 写入 call（尚未观察到）不提醒",
);
assert.equal(
  await providerCallInRun(todoRuntime, "run:Y", 2, todoSignal("run:Y")),
  undefined,
  "run:Y 观察到写入后计数1，不提醒",
);
assert.equal(
  await providerCallInRun(todoRuntime, "run:Y", 3, todoSignal("run:Y")),
  undefined,
  "run:Y 计数2，不提醒",
);
const todoRunY = await providerCallInRun(todoRuntime, "run:Y", 4, todoSignal("run:Y"));
assert.ok(todoRunY, "run:Y 写后第 3 个未写 call（计数3）应注入");
assert.equal(todoRunY.overlay.reminderKind, "todo_idle");
assert.ok(todoRunY.overlay.content.includes(TODO_IDLE_MARK));

const todoNudges = (await todoRuntime.store.list()).filter(
  (nudge) => nudge.id === TODO_IDLE_NUDGE_ID,
);
assert.equal(todoNudges.length, 1, "应恰有一条 todo_idle（被替换而非累积）");
const todoNudge = todoNudges[0];
assert.equal(todoNudge.state, PENDING_NUDGE_STATE.consumed);
assert.equal(todoNudge.targetRunId, "run:Y");
assert.equal(todoNudge.delivery, "once");

// ---------------------------------------------------------------------------
// 5. 真实转换器：system.reminder(kind=compose_mode) → Pi 消息含 <system-reminder>。
// ---------------------------------------------------------------------------
const converter = new CorePiRuntimeMessageConverter();
const piMessages = await converter.convert({
  conversationId,
  runId,
  purpose: PI_RUNTIME_MESSAGE_CONVERSION_PURPOSE.prompt,
  messages: [
    {
      id: "message:reminder:1",
      conversationId,
      role: "system",
      messageType: "system.reminder",
      schemaVersion: 1,
      timestamp: "2026-08-08T00:00:01.000Z",
      payload: {
        kind: "compose_mode",
        content: call1.overlay.content,
        order: 1,
      },
    },
  ],
});
assert.equal(piMessages.length, 1);
assert.equal(piMessages[0].role, "user");
const reminderText = piMessages[0].content[0].text;
assert.ok(reminderText.startsWith('<system-reminder kind="compose_mode">'));
assert.ok(reminderText.includes(call1.overlay.content));
assert.ok(reminderText.endsWith("</system-reminder>"));

// ---------------------------------------------------------------------------
// 6. 脱敏：nudge 内容/参数不得出现在日志或事件中。
// Sensitive content must stay out of logs and events.
// ---------------------------------------------------------------------------
const serializedLogs = JSON.stringify(logs);
const sensitive = [
  COMPOSE_FULL_MARK,
  COMPOSE_SPARSE_MARK,
  COMPOSE_EXIT_MARK,
  TODO_IDLE_MARK,
  DESIGN_FILE,
];
for (const snippet of sensitive) {
  assert.equal(serializedLogs.includes(snippet), false, `日志不得含 ${snippet}`);
}
const serializedEvents = JSON.stringify(
  composeRuntime.publicEvents.concat(todoRuntime.publicEvents),
);
for (const snippet of sensitive) {
  assert.equal(serializedEvents.includes(snippet), false, `事件不得含 ${snippet}`);
}

console.log("nudge definitions smoke passed");
