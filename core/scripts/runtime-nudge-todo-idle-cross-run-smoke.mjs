/**
 * todo_idle 跨 run 冒烟（provider-call 计数）：连续 ≥3 次 provider call 未调用
 * TodoWrite → 每 run 附一条持久化 todo_idle；跨轮清空；写即清空。
 * Cross-run todo_idle smoke: ≥3 provider calls without TodoWrite → attach per run.
 *
 * 复用 nudge-definitions smoke 的 reminder 运行时装配（模板注册 + policy 引擎 +
 * effect coordinator → RuntimeSystemReminderAttachPolicyEffectHandler append
 * SystemReminderAttachedOutputEvent），跨多个 run × 多个 call 驱动同一 policy 实例
 * （child 进程内跨 run 共享 latch），断言：
 * 1. 无 snapshot（todos 缺省）→ 多 call 永不触发，无事件。
 * 2. run:W call#1 写、call#2/3 计数 1/2 → call#4 附 todo_idle；同 run call#5 不重复
 *    （per-run 守卫）。
 * 3. run:X（新 run，跨轮清空）call#1/2 计数 1/2 → call#3 附（跨 run 重新激活）。
 * 4. run:Y call#1 写 → call#2/3 计数 1/2 → call#4 附（写后 3 个未写 call 仍触发）。
 *
 * 信号时序按真实系统建模：TodoWrite 在写入 call 的下一个 call 才被观察到
 * （`lastUpdatedRunId` 滞后一拍），故「写入 call 本身」显示上一写入 run。
 *
 * 安全约束：reminder 正文持久化进事件（append-only 累积），但不得出现在日志里。
 */
import assert from "node:assert/strict";
import {
  NudgeTemplateRegistry,
  RUNTIME_POLICY_PHASE,
  RuntimeEffectCoordinator,
  RuntimePolicyEngine,
  RuntimeSystemReminderAttachPolicyEffectHandler,
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
  for (const definition of NUDGE_DEFINITIONS) templates.register(definition.template);
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
  for (const definition of NUDGE_DEFINITIONS) {
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
  return { appendedEvents, policyEngine, effectCoordinator };
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
  const receipt = await runtime.effectCoordinator.execute({ context, effects });
  return receipt.attachedReminders;
}

// 信号快照：本 call 观察到的 lastUpdatedRunId（写入 call 的下一个 call 才变为新 run）。
const signal = (lastUpdatedRunId) => ({
  todos: { inProgressCount: 1, lastUpdatedRunId },
});

// 1. 无 snapshot：todos 缺省 → 多 call 永不触发。
{
  const conversationId = "conversation:no-snapshot";
  const runtime = createTodoRuntime(conversationId);
  for (let run = 1; run <= 3; run += 1) {
    for (let call = 1; call <= 3; call += 1) {
      assert.deepEqual(
        await providerCall(runtime, conversationId, `run:no-snapshot-${run}`, call, {}),
        [],
        `无 snapshot run:no-snapshot-${run} call#${call} 不应触发`,
      );
    }
  }
  assert.equal(runtime.appendedEvents.length, 0, "无 snapshot 时无持久化事件");
}

// 2-4. 有 snapshot 的多 run × 多 call 场景（单 conversation，latch 共享）。
{
  const conversationId = "conversation:todo-idle";
  const runtime = createTodoRuntime(conversationId);

  // run:seed：首个 TodoWrite，建立 snapshot（lastUpdatedRunId=run:seed）。
  assert.deepEqual(
    await providerCall(runtime, conversationId, "run:seed", 1, signal("run:seed")),
    [],
    "seed 写入 call 不提醒",
  );

  // run:W：call#1 执行 TodoWrite（快照仍为 run:seed，滞后一拍）；call#2 观察到
  // lastUpdatedRunId=run:W → 写即清空，重新计数。
  assert.deepEqual(
    await providerCall(runtime, conversationId, "run:W", 1, signal("run:seed")),
    [],
    "run:W 写入 call（尚未观察到）不提醒",
  );
  assert.deepEqual(
    await providerCall(runtime, conversationId, "run:W", 2, signal("run:W")),
    [],
    "run:W 观察到写入后计数1，不提醒",
  );
  assert.deepEqual(
    await providerCall(runtime, conversationId, "run:W", 3, signal("run:W")),
    [],
    "run:W 计数2，不提醒",
  );
  // 写后第 3 个未写 call → 附 todo_idle。
  const runW = await providerCall(runtime, conversationId, "run:W", 4, signal("run:W"));
  assert.equal(runW.length, 1);
  assert.equal(runW[0].kind, "todo_idle");
  assert.equal(runW[0].reminderId, TODO_IDLE_NUDGE_ID);
  assert.ok(runW[0].content.includes(TODO_IDLE_MARK));
  // 同 run 后续 provider call 不重复（per-run 守卫）。
  assert.deepEqual(
    await providerCall(runtime, conversationId, "run:W", 5, signal("run:W")),
    [],
    "run:W 同 run 不重复提醒",
  );

  // run:X：新 run，跨轮清空 → 计数重新从 1 起。
  assert.deepEqual(
    await providerCall(runtime, conversationId, "run:X", 1, signal("run:W")),
    [],
    "run:X call#1（跨轮清空计数1）不提醒",
  );
  assert.deepEqual(
    await providerCall(runtime, conversationId, "run:X", 2, signal("run:W")),
    [],
    "run:X call#2（计数2）不提醒",
  );
  const runX = await providerCall(runtime, conversationId, "run:X", 3, signal("run:W"));
  assert.equal(runX.length, 1);
  assert.equal(runX[0].kind, "todo_idle");

  // run:Y：call#1 执行 TodoWrite（滞后一拍）；写后 3 个未写 call 仍触发。
  assert.deepEqual(
    await providerCall(runtime, conversationId, "run:Y", 1, signal("run:W")),
    [],
    "run:Y 写入 call（尚未观察到）不提醒",
  );
  assert.deepEqual(
    await providerCall(runtime, conversationId, "run:Y", 2, signal("run:Y")),
    [],
    "run:Y 观察到写入后计数1，不提醒",
  );
  assert.deepEqual(
    await providerCall(runtime, conversationId, "run:Y", 3, signal("run:Y")),
    [],
    "run:Y 计数2，不提醒",
  );
  const runY = await providerCall(runtime, conversationId, "run:Y", 4, signal("run:Y"));
  assert.equal(runY.length, 1);
  assert.equal(runY[0].kind, "todo_idle");
  assert.ok(runY[0].content.includes(TODO_IDLE_MARK));

  // 持久化事件：每 run 至多一条 todo_idle（append-only 累积，不覆盖）。
  const todoEvents = runtime.appendedEvents.filter(
    (event) => event.payload.kind === "todo_idle",
  );
  assert.deepEqual(
    todoEvents.map((event) => event.runId),
    ["run:W", "run:X", "run:Y"],
  );
  assert.deepEqual(
    todoEvents.map((event) => event.payload.reminderId),
    [TODO_IDLE_NUDGE_ID, TODO_IDLE_NUDGE_ID, TODO_IDLE_NUDGE_ID],
  );
}

// 脱敏：reminder 正文持久化进事件，但不得出现在日志中。
assert.equal(
  JSON.stringify(logs).includes(TODO_IDLE_MARK),
  false,
  "日志不得含 TODO_IDLE_MARK",
);

console.log("runtime nudge todo-idle cross-run smoke passed");
