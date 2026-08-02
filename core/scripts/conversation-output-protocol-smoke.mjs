import assert from "node:assert/strict";
import {
  createCoreEventSchemaRegistry,
  EventValidationError,
  HOST_INPUT_HANDLER,
  HOST_INPUT_ROUTING_OUTCOME,
  HostInputRoutedOutputEvent,
  OUTPUT_EVENT_TYPE,
  RUNTIME_PRESENCE_CHANGE_REASON,
  RuntimePresenceChangedOutputEvent,
} from "../dist/index.js";

const registry = createCoreEventSchemaRegistry();

assert.deepEqual(Object.values(OUTPUT_EVENT_TYPE), [
  "system.runtime.presence.changed",
  "system.input.routed",
  "system.input.processed",
  "agent.run.state.changed",
  "agent.turn.state.changed",
  "agent.assistant.message.started",
  "agent.assistant.message.delta",
  "agent.assistant.message.completed",
  "agent.assistant.message.failed",
  "agent.assistant.message.cancelled",
  "system.nudge.scheduled",
  "system.reminder.injected",
  "system.nudge.expired",
  "system.context.compaction.started",
  "system.context.compaction.completed",
  "system.context.compaction.failed",
  "system.context.checkpoint.applied",
  "system.tool.approval.requested",
  "system.tool.approval.resolved",
  "system.tool.trace.recorded",
  "novel.draft.started",
  "novel.draft.status.changed",
  "novel.draft.rolled.back",
  "novel.draft.operation.applied",
  "novel.commit.completed",
  "novel.commit.recovered",
  "novel.rebase.prepared",
  "novel.rebase.conflicted",
  "novel.rebase.resolved",
  "novel.rebase.promoted",
  "novel.conflict.detected",
  "novel.conflict.resolved",
  "novel.recovery.completed",
  "novel.approval.requested",
]);

const previous = {
  state: "offline",
  observedAt: "2026-08-01T00:00:00.000Z",
};
const current = {
  state: "starting",
  observedAt: "2026-08-01T00:00:01.000Z",
};
const presenceEvent = new RuntimePresenceChangedOutputEvent({
  conversationId: "conversation-output-protocol",
  id: "output-presence-1",
  previous,
  current,
  reason: RUNTIME_PRESENCE_CHANGE_REASON.acceptedInput,
  correlationId: "correlation-presence-1",
});

previous.state = "crashed";
current.state = "online";
const presenceSnapshot = presenceEvent.getSnapshot();
assert.deepEqual(presenceSnapshot, {
  id: "output-presence-1",
  conversationId: "conversation-output-protocol",
  eventType: "system.runtime.presence.changed",
  schemaVersion: 1,
  timestamp: "2026-08-01T00:00:01.000Z",
  correlationId: "correlation-presence-1",
  payload: {
    previous: {
      state: "offline",
      observedAt: "2026-08-01T00:00:00.000Z",
    },
    current: {
      state: "starting",
      observedAt: "2026-08-01T00:00:01.000Z",
    },
    reason: "accepted_input",
  },
});
assert.deepEqual(registry.validateOutput(presenceSnapshot), presenceSnapshot);
for (const forbidden of [
  "runtimeInstanceId",
  "generation",
  "pid",
  "workerId",
  "transport",
]) {
  assert.equal(JSON.stringify(presenceSnapshot).includes(forbidden), false);
}

const inputEvent = {
  id: "input-stop-2",
  eventType: "system.stop",
  sequence: 17,
};
const routedEvent = new HostInputRoutedOutputEvent({
  conversationId: "conversation-output-protocol",
  id: "output-routed-2",
  timestamp: "2026-08-01T00:00:02.000Z",
  inputEvent,
  handler: HOST_INPUT_HANDLER.stop,
  outcome: HOST_INPUT_ROUTING_OUTCOME.runtimeNotified,
  runId: "run-output-protocol",
});
inputEvent.id = "mutated-input";
inputEvent.sequence = 999;

const routedSnapshot = routedEvent.getSnapshot();
assert.deepEqual(routedSnapshot, {
  id: "output-routed-2",
  conversationId: "conversation-output-protocol",
  eventType: "system.input.routed",
  schemaVersion: 1,
  timestamp: "2026-08-01T00:00:02.000Z",
  causationId: "input-stop-2",
  runId: "run-output-protocol",
  payload: {
    handler: "stop",
    outcome: "runtime_notified",
  },
  inputEvent: {
    id: "input-stop-2",
    eventType: "system.stop",
    sequence: 17,
  },
});
assert.deepEqual(registry.validateOutput(routedSnapshot), routedSnapshot);
assert.equal(Object.isFrozen(routedEvent.inputEvent), true);

const explicitCausation = new HostInputRoutedOutputEvent({
  conversationId: "conversation-output-protocol",
  id: "output-routed-3",
  timestamp: "2026-08-01T00:00:03.000Z",
  causationId: "explicit-causation",
  inputEvent: {
    id: "input-reload-3",
    eventType: "command.config.reload",
    sequence: 18,
  },
  handler: HOST_INPUT_HANDLER.reloadConfig,
  outcome: HOST_INPUT_ROUTING_OUTCOME.deferred,
});
assert.equal(explicitCausation.getSnapshot().causationId, "explicit-causation");

assert.throws(
  () =>
    new HostInputRoutedOutputEvent({
      conversationId: "conversation-output-protocol",
      inputEvent: {
        id: "input-without-sequence",
        eventType: "system.stop",
      },
      handler: HOST_INPUT_HANDLER.stop,
      outcome: HOST_INPUT_ROUTING_OUTCOME.noRuntime,
    }),
  TypeError,
);

assert.throws(
  () =>
    registry.validateOutput({
      ...presenceSnapshot,
      payload: {
        ...presenceSnapshot.payload,
        reason: "unregistered_reason",
      },
    }),
  EventValidationError,
);
assert.throws(
  () =>
    registry.validateOutput({
      ...routedSnapshot,
      payload: {
        handler: "stop",
        outcome: "stop_completed",
      },
    }),
  EventValidationError,
);

console.log("conversation output protocol smoke passed");
