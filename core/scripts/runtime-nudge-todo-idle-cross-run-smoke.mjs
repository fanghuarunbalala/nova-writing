/**
 * todo_idle 跨 run 冒烟（provider-call 计数）：连续 ≥3 次 provider call 未调用
 * TodoWrite → 每 run 注入一次；跨轮清空；写即清空。
 * Cross-run todo_idle smoke: ≥3 provider calls without TodoWrite → inject per run.
 *
 * 复用 nudge-definitions smoke 的运行时装配（store + manager + policy engine +
 * effect coordinator），跨多个 run × 多个 call 驱动同一 policy 实例（child 进程内
 * 跨 run 共享 latch），断言：
 * 1. 无 snapshot（todos 缺省）→ 多 call 永不触发，store 恒空。
 * 2. run:W call#1 写、call#2/3 计数 1/2 → call#4 注入；同 run call#5 不重复（per-run 守卫）。
 * 3. run:X（新 run，跨轮清空）call#1/2 计数 1/2 → call#3 注入（store 跨 run 重新激活，
 *    替换而非累积，单条 consumed）。
 * 4. run:Y call#1 写 → call#2/3 计数 1/2 → call#4 注入（写后 3 个未写 call 仍触发）。
 *
 * 信号时序按真实系统建模：TodoWrite 在写入 call 的下一个 call 才被观察到
 * （`lastUpdatedRunId` 滞后一拍），故「写入 call 本身」显示上一写入 run。
 *
 * 安全约束：nudge 内容/参数不进日志/事件；TODO_IDLE_MARK 只用于内容断言。
 */
import assert from "node:assert/strict";
import {
  InMemoryPendingNudgeStore,
  NudgeManager,
  NudgeProviderCallCoordinator,
  NudgeRenderer,
  NudgeSelector,
  NudgeTemplateRegistry,
  PENDING_NUDGE_STATE,
  RUNTIME_POLICY_PHASE,
  RuntimeEffectCoordinator,
  RuntimeNudgePolicyEffectHandler,
  RuntimePolicyEngine,
} from "../dist/index.js";
import { NUDGE_DEFINITIONS } from "../dist/runtime/nudge/definitions/index.js";
import {
  TODO_IDLE_MARK,
  TODO_IDLE_NUDGE_ID,
} from "../dist/runtime/nudge/definitions/todo.js";

const logs = [];
const logger = {
  debug: (event, fields) => logs.push({ level: "debug", event, fields }),
  info: (event, fields) => logs.push({ level: "info", event, fields }),
  warn: (event, fields) => logs.push({ level: "warn", event, fields }),
  error: (event, fields) => logs.push({ level: "error", event, fields }),
  child: () => logger,
};

function createTodoRuntime(conversationId) {
  const templates = new NudgeTemplateRegistry({ logger });
  const store = new InMemoryPendingNudgeStore({ logger });
  const manager = new NudgeManager({
    store,
    selector: new NudgeSelector({ logger }),
    renderer: new NudgeRenderer({ templates, logger }),
    leaseIdFactory: { create: (request) => `lease:${request.providerCallId}` },
    logger,
  });
  const coordinator = new NudgeProviderCallCoordinator({
    manager,
    privateStateCommitter: { commit: async () => {} },
    eventSink: {
      append: async (event) => {
        const snapshot = event.getSnapshot();
        return {
          status: "recorded",
          conversationId: snapshot.conversationId,
          eventId: snapshot.id,
          sequence: 1,
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
  for (const definition of NUDGE_DEFINITIONS) templates.register(definition.template);
  const deduped = [];
  const ids = new Set();
  for (const definition of NUDGE_DEFINITIONS) {
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
  return { store, coordinator, policyEngine, effectCoordinator };
}

async function providerCall(runtime, conversationId, runIdValue, ordinal, signals) {
  const providerCallId = `pc:${runIdValue}:${ordinal}`;
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

// 信号快照：本 call 观察到的 lastUpdatedRunId（写入 call 的下一个 call 才变为新 run）。
const signal = (lastUpdatedRunId) => ({
  todos: { inProgressCount: 1, lastUpdatedRunId },
});

async function assertTodoNudge(runtime, targetRunId) {
  const nudges = (await runtime.store.list()).filter(
    (nudge) => nudge.id === TODO_IDLE_NUDGE_ID,
  );
  assert.equal(nudges.length, 1, "恰一条 todo_idle（被替换而非累积）");
  assert.equal(nudges[0].state, PENDING_NUDGE_STATE.consumed);
  assert.equal(nudges[0].targetRunId, targetRunId);
  assert.equal(nudges[0].delivery, "once");
}

// 1. 无 snapshot：todos 缺省 → 多 call 永不触发。
{
  const conversationId = "conversation:no-snapshot";
  const runtime = createTodoRuntime(conversationId);
  for (let run = 1; run <= 3; run += 1) {
    for (let call = 1; call <= 3; call += 1) {
      assert.equal(
        await providerCall(runtime, conversationId, `run:no-snapshot-${run}`, call, {}),
        undefined,
        `无 snapshot run:no-snapshot-${run} call#${call} 不应触发`,
      );
    }
  }
  assert.equal(
    (await runtime.store.list()).length,
    0,
    "无 snapshot 时 store 恒空",
  );
}

// 2-4. 有 snapshot 的多 run × 多 call 场景（单 conversation，latch + store 共享）。
{
  const conversationId = "conversation:todo-idle";
  const runtime = createTodoRuntime(conversationId);

  // run:seed：首个 TodoWrite，建立 snapshot（lastUpdatedRunId=run:seed）。
  assert.equal(
    await providerCall(runtime, conversationId, "run:seed", 1, signal("run:seed")),
    undefined,
    "seed 写入 call 不提醒",
  );

  // run:W：call#1 执行 TodoWrite（快照仍为 run:seed，滞后一拍）；call#2 观察到
  // lastUpdatedRunId=run:W → 写即清空，重新计数。
  assert.equal(
    await providerCall(runtime, conversationId, "run:W", 1, signal("run:seed")),
    undefined,
    "run:W 写入 call（尚未观察到）不提醒",
  );
  assert.equal(
    await providerCall(runtime, conversationId, "run:W", 2, signal("run:W")),
    undefined,
    "run:W 观察到写入后计数1，不提醒",
  );
  assert.equal(
    await providerCall(runtime, conversationId, "run:W", 3, signal("run:W")),
    undefined,
    "run:W 计数2，不提醒",
  );
  // 写后第 3 个未写 call → 注入。
  const runW = await providerCall(runtime, conversationId, "run:W", 4, signal("run:W"));
  assert.ok(runW, "run:W call#4（计数3）应注入");
  assert.equal(runW.overlay.reminderKind, "todo_idle");
  assert.ok(runW.overlay.content.includes(TODO_IDLE_MARK));
  // 同 run 后续 provider call 不重复（per-run 守卫）。
  assert.equal(
    await providerCall(runtime, conversationId, "run:W", 5, signal("run:W")),
    undefined,
    "run:W 同 run 不重复提醒",
  );

  // run:X：新 run，跨轮清空 → 计数重新从 1 起。
  assert.equal(
    await providerCall(runtime, conversationId, "run:X", 1, signal("run:W")),
    undefined,
    "run:X call#1（跨轮清空计数1）不提醒",
  );
  assert.equal(
    await providerCall(runtime, conversationId, "run:X", 2, signal("run:W")),
    undefined,
    "run:X call#2（计数2）不提醒",
  );
  const runX = await providerCall(runtime, conversationId, "run:X", 3, signal("run:W"));
  assert.ok(runX, "run:X call#3（计数3）应注入（跨 run 重新激活）");
  assert.equal(runX.overlay.reminderKind, "todo_idle");
  await assertTodoNudge(runtime, "run:X");

  // run:Y：call#1 执行 TodoWrite（滞后一拍）；写后 3 个未写 call 仍触发。
  assert.equal(
    await providerCall(runtime, conversationId, "run:Y", 1, signal("run:W")),
    undefined,
    "run:Y 写入 call（尚未观察到）不提醒",
  );
  assert.equal(
    await providerCall(runtime, conversationId, "run:Y", 2, signal("run:Y")),
    undefined,
    "run:Y 观察到写入后计数1，不提醒",
  );
  assert.equal(
    await providerCall(runtime, conversationId, "run:Y", 3, signal("run:Y")),
    undefined,
    "run:Y 计数2，不提醒",
  );
  const runY = await providerCall(runtime, conversationId, "run:Y", 4, signal("run:Y"));
  assert.ok(runY, "run:Y call#4（写后第 3 个未写 call，计数3）应注入");
  assert.equal(runY.overlay.reminderKind, "todo_idle");
  assert.ok(runY.overlay.content.includes(TODO_IDLE_MARK));
  await assertTodoNudge(runtime, "run:Y");
}

// 脱敏：nudge 内容/参数不得出现在日志中。
assert.equal(
  JSON.stringify(logs).includes(TODO_IDLE_MARK),
  false,
  "日志不得含 TODO_IDLE_MARK",
);

console.log("runtime nudge todo-idle cross-run smoke passed");
