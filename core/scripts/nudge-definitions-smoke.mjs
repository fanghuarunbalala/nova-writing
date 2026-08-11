/**
 * nudge 定义集中装配冒烟：definitions/ 目录 + agent nudgeEnablement ∩ 工具组守卫。
 * Nudge-definitions assembly smoke: centralized definitions + agent enablements ∩ tool-group guard.
 *
 * 验证 / Verifies:
 * 1. 生效集：NUDGE_DEFINITIONS + novelAgentDefinition.nudgeEnablement.enabled ∩ 工具组
 *    守卫 → 恰为 [compose_mode, compose_mode_pending, compose_mode_reentry,
 *    compose_mode_exit, compose_mode_sparse, todo_idle]；未配置 nudgeEnablement 的
 *    AgentDefinition → 空集；缺组 → 跳过。
 * 2. 共享 policy 去重：compose 全部定义同属 ComposeModeNudgePolicy → 引擎只注册一个实例。
 * 3. compose_mode：transition 驱动——inactive→active 附一条持久化 compose_mode（含设计文件
 *    workspace 相对路径）；持续 active 不重复；active→inactive 附一条 compose_mode_exit；
 *    随后无附。seed(active) 后首 call 不重发 compose_mode。
 * 3b. compose_mode_pending：designing→pending 附一条持久化 pending；持续 pending 不重复。
 * 3c. compose_mode_reentry：false→true 且 hasPriorDraft=true → 附 compose_mode + reentry；
 *     无旧草稿只附 compose_mode。
 * 3d. compose_mode_sparse：仍 compose 无 transition，跨 run 每 N 次 provider call 附一次
 *     瞬态 sparse（入 attachedReminders，不入 canonical appendedEvents；每 run 至多一次）。
 * 4. todo_idle：连续 ≥3 次 provider call 未调用 TodoWrite → 每 run 附一条持久化 todo_idle；
 *    跨轮清空；TodoWrite 一调用即重置（写后重新计数，写后 3 个未写 call 仍触发）。
 * 5. 真实 CorePiRuntimeMessageConverter 把 system.reminder（kind=compose_mode）转成
 *    Pi user 消息，内容含 <system-reminder kind="compose_mode">。
 * 6. 脱敏：reminder 正文持久化进事件（append-only，投影 canonical），但不得出现在日志里；
 *    sparse 为瞬态，不得出现在任何 canonical 事件里。
 */
import assert from "node:assert/strict";
import path from "node:path";
import {
  AgentCommunicationPolicy,
  AgentDefinition,
  AgentDelegationPolicy,
  AgentToolPolicy,
  NudgeTemplateRegistry,
  PromptRecipe,
  PromptSectionItem,
  RUNTIME_POLICY_PHASE,
  RuntimeEffectCoordinator,
  RuntimePolicyEngine,
  RuntimeSystemReminderAttachPolicyEffectHandler,
  novelAgentDefinition,
} from "../dist/index.js";
import {
  CorePiRuntimeMessageConverter,
  PI_RUNTIME_MESSAGE_CONVERSION_PURPOSE,
} from "../dist/runtime/agent/pi/index.js";
import { NUDGE_DEFINITIONS } from "../dist/runtime/nudge/definitions/index.js";
import {
  COMPOSE_MODE_EXIT_NUDGE_ID,
  COMPOSE_MODE_NUDGE_ID,
  COMPOSE_MODE_PENDING_NUDGE_ID,
  COMPOSE_MODE_REENTRY_NUDGE_ID,
  COMPOSE_MODE_SPARSE_EVERY_CALLS,
  COMPOSE_MODE_SPARSE_NUDGE_ID,
  COMPOSE_MODE_TOOL_GROUP,
  ComposeModeNudgePolicy,
} from "../dist/runtime/nudge/definitions/compose.js";
import {
  TODO_IDLE_NUDGE_ID,
  TODO_IDLE_TOOL_GROUP,
} from "../dist/runtime/nudge/definitions/todo.js";

const COMPOSE_FULL_MARK = "# 设计模式（Compose Mode）";
const COMPOSE_PENDING_MARK = "# 设计模式：等待审批";
const COMPOSE_REENTRY_MARK = "# 设计模式：已有旧草稿";
const COMPOSE_SPARSE_MARK = "# 设计模式（刷新）";
const COMPOSE_EXIT_MARK = "# 设计模式已结束";
const TODO_IDLE_MARK = "待办列表维护提醒";
/** 绝对 design 路径（真实场景），渲染时转 workspace 相对。原生分隔符保证跨平台 basename 生效。 */
const DESIGN_FILE_ABSOLUTE = path.resolve(".novel", "design", "chapter-3.md");
const DESIGN_FILE_RELATIVE = ".novel/design/chapter-3.md";

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
  COMPOSE_MODE_PENDING_NUDGE_ID,
  COMPOSE_MODE_REENTRY_NUDGE_ID,
  COMPOSE_MODE_EXIT_NUDGE_ID,
  COMPOSE_MODE_SPARSE_NUDGE_ID,
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
  [
    COMPOSE_MODE_NUDGE_ID,
    COMPOSE_MODE_PENDING_NUDGE_ID,
    COMPOSE_MODE_REENTRY_NUDGE_ID,
    COMPOSE_MODE_EXIT_NUDGE_ID,
    COMPOSE_MODE_SPARSE_NUDGE_ID,
    TODO_IDLE_NUDGE_ID,
  ],
);

// 缺 runtime.todo 组 → todo_idle 被守卫跳过。
const composeOnly = effectiveDefinitions(new Set([COMPOSE_MODE_TOOL_GROUP]));
assert.deepEqual(
  composeOnly.map((definition) => definition.id),
  [
    COMPOSE_MODE_NUDGE_ID,
    COMPOSE_MODE_PENDING_NUDGE_ID,
    COMPOSE_MODE_REENTRY_NUDGE_ID,
    COMPOSE_MODE_EXIT_NUDGE_ID,
    COMPOSE_MODE_SPARSE_NUDGE_ID,
  ],
);

// 2. 共享 policy 去重：compose 全部定义 → 单个 ComposeModeNudgePolicy。
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
// reminder 运行时装配（对齐 DesktopRuntimeChildCompositionFactory：模板注册 +
// policy 引擎 + effect coordinator → RuntimeSystemReminderAttachPolicyEffectHandler
// append SystemReminderAttachedOutputEvent → 投影 canonical system.reminder）。
// ---------------------------------------------------------------------------
function createReminderRuntime(definitions) {
  const templates = new NudgeTemplateRegistry({ logger });
  for (const definition of definitions) templates.register(definition.template);
  const appendedEvents = [];
  const eventSink = {
    async append(event) {
      appendedEvents.push(event);
      return {
        status: "recorded",
        conversationId: event.conversationId,
        eventId: event.id,
        sequence: appendedEvents.length,
        recordedAt: "2026-08-08T00:00:01.000Z",
      };
    },
  };
  const handler = new RuntimeSystemReminderAttachPolicyEffectHandler({
    eventSink,
    templates,
    logger,
  });
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
    systemReminderAttachHandler: handler,
    logger,
  });
  return {
    appendedEvents,
    policyEngine,
    effectCoordinator,
    policies: deduped,
  };
}

// 单条 provider call：求值 policies → 执行效果 → 返回本调用附的 reminders。
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
  const receipt = await runtime.effectCoordinator.execute({ context, effects });
  return receipt.attachedReminders;
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
  const receipt = await runtime.effectCoordinator.execute({ context, effects });
  return receipt.attachedReminders;
}

const composeActive = {
  compose: {
    phase: "designing",
    active: true,
    mode: "compose",
    designFilePath: DESIGN_FILE_ABSOLUTE,
  },
};
const composeInactive = { compose: { phase: "idle", active: false, mode: "compose" } };

// ---------------------------------------------------------------------------
// 3. compose_mode transition 驱动。
// ---------------------------------------------------------------------------
const composeRuntime = createReminderRuntime(fullEffective);

// call#1：inactive → latch 初始 false，无 transition。
assert.deepEqual(
  await providerCall(composeRuntime, 1, composeInactive),
  [],
  "call#1 首次 inactive 不附",
);
// call#2：false→true 上升沿 → 附一条持久化 compose_mode（含 workspace 相对路径）。
const composeEntered = await providerCall(composeRuntime, 2, composeActive);
assert.equal(composeEntered.length, 1);
assert.equal(composeEntered[0].kind, "compose_mode");
assert.equal(composeEntered[0].reminderId, COMPOSE_MODE_NUDGE_ID);
assert.ok(composeEntered[0].content.includes(COMPOSE_FULL_MARK));
assert.ok(composeEntered[0].content.includes(DESIGN_FILE_RELATIVE));
// call#3-10：持续 active，无 transition → 不重复附。
for (let ordinal = 3; ordinal <= 10; ordinal += 1) {
  assert.deepEqual(
    await providerCall(composeRuntime, ordinal, composeActive),
    [],
    `call#${ordinal} 持续 active 不应重复附`,
  );
}
// call#11：true→false 下降沿 → 附一条 compose_mode_exit。
const composeExited = await providerCall(composeRuntime, 11, composeInactive);
assert.equal(composeExited.length, 1);
assert.equal(composeExited[0].kind, "compose_mode_exit");
assert.equal(composeExited[0].reminderId, COMPOSE_MODE_EXIT_NUDGE_ID);
assert.ok(composeExited[0].content.includes(COMPOSE_EXIT_MARK));
// call#12+：持续 inactive → 无附。
assert.deepEqual(
  await providerCall(composeRuntime, 12, composeInactive),
  [],
  "call#12 持续 inactive 不附",
);
// 持久化事件：恰好 compose_mode + compose_mode_exit 各一条，顺序单调。
const composeEvents = composeRuntime.appendedEvents;
assert.equal(composeEvents.length, 2);
assert.deepEqual(
  composeEvents.map((event) => event.payload.kind),
  ["compose_mode", "compose_mode_exit"],
);
assert.ok(composeEvents[0].payload.order < composeEvents[1].payload.order);

// seed：已 active 的 latch 不应把首 call 误判为上升沿而重发 compose_mode。
const seededRuntime = createReminderRuntime(fullEffective);
for (const policy of seededRuntime.policies) {
  if (policy instanceof ComposeModeNudgePolicy) {
    policy.seed(conversationId, {
      phase: "designing",
      active: true,
      mode: "compose",
    });
  }
}
assert.deepEqual(
  await providerCall(seededRuntime, 1, composeActive),
  [],
  "seed active 后首 call 不重发 compose_mode",
);
// 退出仍触发下降沿。
const seededExit = await providerCall(seededRuntime, 2, composeInactive);
assert.equal(seededExit.length, 1);
assert.equal(seededExit[0].kind, "compose_mode_exit");

// ---------------------------------------------------------------------------
// 3b. compose_mode_pending：designing→pending（ExitComposeMode 提交）→ 附一条持久化 pending。
// ---------------------------------------------------------------------------
const pendingRuntime = createReminderRuntime(fullEffective);
// 先建立 inactive latch（真实流程总先观测到 inactive，再 EnterComposeMode）。
assert.deepEqual(await providerCall(pendingRuntime, 1, composeInactive), []);
const pendingEntered = await providerCall(pendingRuntime, 2, composeActive);
assert.equal(pendingEntered.length, 1);
assert.equal(pendingEntered[0].kind, "compose_mode");
const pendingSubmitted = await providerCall(pendingRuntime, 3, {
  compose: {
    phase: "pending",
    active: true,
    mode: "compose",
    designFilePath: DESIGN_FILE_ABSOLUTE,
  },
});
assert.equal(pendingSubmitted.length, 1);
assert.equal(pendingSubmitted[0].kind, "compose_mode_pending");
assert.equal(pendingSubmitted[0].reminderId, COMPOSE_MODE_PENDING_NUDGE_ID);
assert.ok(pendingSubmitted[0].content.includes(COMPOSE_PENDING_MARK));
// 持续 pending 不重复。
assert.deepEqual(
  await providerCall(pendingRuntime, 4, {
    compose: { phase: "pending", active: true, mode: "compose" },
  }),
  [],
  "持续 pending 不重复附",
);
const pendingEvents = pendingRuntime.appendedEvents;
assert.deepEqual(
  pendingEvents.map((event) => event.payload.kind),
  ["compose_mode", "compose_mode_pending"],
);

// 多切换间隔：inactive → (enter) → (submit) 都在两次 provider call 之间发生，
// 采样落点为 pending → 应发 compose_mode_pending，而非误发 compose_mode(designing 指引)。
const multiSwitchRuntime = createReminderRuntime(fullEffective);
assert.deepEqual(await providerCall(multiSwitchRuntime, 1, composeInactive), []);
const multiSwitchPending = await providerCall(multiSwitchRuntime, 2, {
  compose: {
    phase: "pending",
    active: true,
    mode: "compose",
    designFilePath: DESIGN_FILE_ABSOLUTE,
  },
});
assert.equal(multiSwitchPending.length, 1);
assert.equal(multiSwitchPending[0].kind, "compose_mode_pending");
assert.equal(multiSwitchPending[0].reminderId, COMPOSE_MODE_PENDING_NUDGE_ID);

// ---------------------------------------------------------------------------
// 3c. compose_mode_reentry：false→true 且 hasPriorDraft=true → 附 compose_mode + reentry。
// ---------------------------------------------------------------------------
const reentryRuntime = createReminderRuntime(fullEffective);
assert.deepEqual(await providerCall(reentryRuntime, 1, composeInactive), []);
const reentryEntered = await providerCall(reentryRuntime, 2, {
  compose: {
    phase: "designing",
    active: true,
    mode: "compose",
    designFilePath: DESIGN_FILE_ABSOLUTE,
    hasPriorDraft: true,
    purpose: "第三章",
  },
});
assert.equal(reentryEntered.length, 2);
assert.deepEqual(
  reentryEntered.map((reminder) => reminder.kind),
  ["compose_mode", "compose_mode_reentry"],
);
assert.equal(reentryEntered[1].reminderId, COMPOSE_MODE_REENTRY_NUDGE_ID);
assert.ok(reentryEntered[1].content.includes(COMPOSE_REENTRY_MARK));
assert.ok(
  reentryEntered[1].content.includes("上次创作意图：第三章"),
  "reentry 提醒引用上次创作意图",
);
// 无旧草稿进入 → 只附 compose_mode。
const freshRuntime = createReminderRuntime(fullEffective);
assert.deepEqual(await providerCall(freshRuntime, 1, composeInactive), []);
const freshEntered = await providerCall(freshRuntime, 2, composeActive);
assert.equal(freshEntered.length, 1);
assert.equal(freshEntered[0].kind, "compose_mode");
assert.equal(
  reentryRuntime.appendedEvents.length,
  2,
  "reentry 事件应为 compose_mode + compose_mode_reentry",
);

// ---------------------------------------------------------------------------
// 3d. compose_mode_sparse：仍 compose 无 transition，跨 run 每 N 次 provider call 附
//     一次瞬态 sparse（入 attachedReminders，不入 canonical appendedEvents）。
// ---------------------------------------------------------------------------
const sparseRuntime = createReminderRuntime(fullEffective);
// run:seed：inactive 建立 latch。
assert.deepEqual(
  await providerCallInRun(sparseRuntime, "run:seed", 1, composeInactive),
  [],
);
// run:enter：进入 → full compose_mode（持久化），lastSparseRunId=run:enter。
const sparseEntered = await providerCallInRun(
  sparseRuntime,
  "run:enter",
  1,
  composeActive,
);
assert.equal(sparseEntered.length, 1);
assert.equal(sparseEntered[0].kind, "compose_mode");
// run:refresh：跨 run，前 N-1 次不附，第 N 次附一次瞬态 sparse。
for (let call = 1; call < COMPOSE_MODE_SPARSE_EVERY_CALLS; call += 1) {
  assert.deepEqual(
    await providerCallInRun(sparseRuntime, "run:refresh", call, composeActive),
    [],
    `run:refresh call#${call} 不附 sparse`,
  );
}
const sparseFired = await providerCallInRun(
  sparseRuntime,
  "run:refresh",
  COMPOSE_MODE_SPARSE_EVERY_CALLS,
  composeActive,
);
assert.equal(sparseFired.length, 1);
assert.equal(sparseFired[0].kind, "compose_mode_sparse");
assert.equal(sparseFired[0].reminderId, COMPOSE_MODE_SPARSE_NUDGE_ID);
assert.ok(sparseFired[0].content.includes(COMPOSE_SPARSE_MARK));
// 同 run 后续 call 不重复（per-run 守卫）。
assert.deepEqual(
  await providerCallInRun(
    sparseRuntime,
    "run:refresh",
    COMPOSE_MODE_SPARSE_EVERY_CALLS + 1,
    composeActive,
  ),
  [],
  "run:refresh 同 run 不重复 sparse",
);
// sparse 瞬态：attachedReminders 有，但 canonical appendedEvents 只有 compose_mode。
assert.deepEqual(
  sparseRuntime.appendedEvents.map((event) => event.payload.kind),
  ["compose_mode"],
  "sparse 不入 canonical",
);

// ---------------------------------------------------------------------------
// 4. todo_idle：连续 ≥3 次 provider call 未调用 TodoWrite → 每 run 附一条持久化
//    todo_idle；跨轮清空；写即清空（写后重新计数，写后 3 个未写 call 仍触发）。
//    信号滞后建模：TodoWrite 在写入 call 的下一个 call 才被观察到
//    （lastUpdatedRunId 滞后一拍），故「写入 call 本身」显示上一写入 run。
// ---------------------------------------------------------------------------
const todoRuntime = createReminderRuntime(fullEffective);
const todoSignal = (lastUpdatedRunId) => ({
  todos: { inProgressCount: 1, lastUpdatedRunId },
});

// run:seed：首个 TodoWrite，建立 snapshot（lastUpdatedRunId=run:seed）。
assert.deepEqual(
  await providerCallInRun(todoRuntime, "run:seed", 1, todoSignal("run:seed")),
  [],
  "seed 写入 call 不提醒",
);
// run:W：call#1 执行 TodoWrite（滞后一拍）；call#2 观察到 → 写即清空，重新计数。
assert.deepEqual(
  await providerCallInRun(todoRuntime, "run:W", 1, todoSignal("run:seed")),
  [],
  "run:W 写入 call（尚未观察到）不提醒",
);
assert.deepEqual(
  await providerCallInRun(todoRuntime, "run:W", 2, todoSignal("run:W")),
  [],
  "run:W 观察到写入后计数1，不提醒",
);
assert.deepEqual(
  await providerCallInRun(todoRuntime, "run:W", 3, todoSignal("run:W")),
  [],
  "run:W 计数2，不提醒",
);
const todoRunW = await providerCallInRun(todoRuntime, "run:W", 4, todoSignal("run:W"));
assert.equal(todoRunW.length, 1);
assert.equal(todoRunW[0].kind, "todo_idle");
assert.equal(todoRunW[0].reminderId, TODO_IDLE_NUDGE_ID);
assert.ok(todoRunW[0].content.includes(TODO_IDLE_MARK));
// 同 run 后续 provider call 不重复（per-run 守卫）。
assert.deepEqual(
  await providerCallInRun(todoRuntime, "run:W", 5, todoSignal("run:W")),
  [],
  "同 run 不重复提醒",
);
// run:X：新 run，跨轮清空 → 计数重新从 1 起，第 3 个未写 call 再次附。
assert.deepEqual(
  await providerCallInRun(todoRuntime, "run:X", 1, todoSignal("run:W")),
  [],
  "run:X call#1（跨轮清空计数1）不提醒",
);
assert.deepEqual(
  await providerCallInRun(todoRuntime, "run:X", 2, todoSignal("run:W")),
  [],
  "run:X call#2（计数2）不提醒",
);
const todoRunX = await providerCallInRun(todoRuntime, "run:X", 3, todoSignal("run:W"));
assert.equal(todoRunX.length, 1);
assert.equal(todoRunX[0].kind, "todo_idle");
// run:Y：call#1 执行 TodoWrite（滞后一拍）；写后 3 个未写 call 仍触发。
assert.deepEqual(
  await providerCallInRun(todoRuntime, "run:Y", 1, todoSignal("run:W")),
  [],
  "run:Y 写入 call（尚未观察到）不提醒",
);
assert.deepEqual(
  await providerCallInRun(todoRuntime, "run:Y", 2, todoSignal("run:Y")),
  [],
  "run:Y 观察到写入后计数1，不提醒",
);
assert.deepEqual(
  await providerCallInRun(todoRuntime, "run:Y", 3, todoSignal("run:Y")),
  [],
  "run:Y 计数2，不提醒",
);
const todoRunY = await providerCallInRun(todoRuntime, "run:Y", 4, todoSignal("run:Y"));
assert.equal(todoRunY.length, 1);
assert.equal(todoRunY[0].kind, "todo_idle");
assert.ok(todoRunY[0].content.includes(TODO_IDLE_MARK));

// 持久化事件：每 run 至多一条 todo_idle（append-only 累积，不覆盖）。
const todoEvents = todoRuntime.appendedEvents.filter(
  (event) => event.payload.kind === "todo_idle",
);
assert.deepEqual(
  todoEvents.map((event) => event.runId),
  ["run:W", "run:X", "run:Y"],
);

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
        content: composeEvents[0].payload.content,
        order: composeEvents[0].payload.order,
      },
    },
  ],
});
assert.equal(piMessages.length, 1);
assert.equal(piMessages[0].role, "user");
const reminderText = piMessages[0].content[0].text;
assert.ok(reminderText.startsWith('<system-reminder kind="compose_mode">'));
assert.ok(reminderText.includes(composeEvents[0].payload.content));
assert.ok(reminderText.endsWith("</system-reminder>"));

// ---------------------------------------------------------------------------
// 6. 脱敏：reminder 正文持久化进事件（投影 canonical），但不得出现在日志里。
// Sensitive rendered content persists into events, but must stay out of logs.
// ---------------------------------------------------------------------------
const serializedLogs = JSON.stringify(logs);
for (const snippet of [
  COMPOSE_FULL_MARK,
  COMPOSE_PENDING_MARK,
  COMPOSE_REENTRY_MARK,
  COMPOSE_SPARSE_MARK,
  COMPOSE_EXIT_MARK,
  TODO_IDLE_MARK,
]) {
  assert.equal(serializedLogs.includes(snippet), false, `日志不得含 ${snippet}`);
}
const serializedEvents = JSON.stringify(
  composeRuntime.appendedEvents.concat(
    todoRuntime.appendedEvents,
    pendingRuntime.appendedEvents,
    reentryRuntime.appendedEvents,
  ),
);
assert.ok(serializedEvents.includes(COMPOSE_FULL_MARK));
assert.ok(serializedEvents.includes(COMPOSE_PENDING_MARK));
assert.ok(serializedEvents.includes(COMPOSE_REENTRY_MARK));
assert.ok(serializedEvents.includes(COMPOSE_EXIT_MARK));
assert.ok(serializedEvents.includes(TODO_IDLE_MARK));
// sparse 是瞬态，不得出现在任何 canonical 事件序列化里。
assert.equal(serializedEvents.includes(COMPOSE_SPARSE_MARK), false);

console.log("nudge definitions smoke passed");
