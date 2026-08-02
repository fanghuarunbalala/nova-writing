import assert from "node:assert/strict";
import {
  createCoreEventSchemaRegistry,
  EventValidationError,
  NudgeExpiredOutputEvent,
  NudgeScheduledOutputEvent,
  OUTPUT_EVENT_TYPE,
  SystemReminderInjectedOutputEvent,
} from "../dist/index.js";

const registry = createCoreEventSchemaRegistry();
const forbiddenOptions = {
  parameters: { privateValue: "SENSITIVE_NUDGE_PARAMETER" },
  renderedReminder: "SENSITIVE_RENDERED_REMINDER",
  dedupeKey: "SENSITIVE_DEDUPE_TARGET",
  priority: 99,
  cooldownTurns: 2,
  expiresAt: "2026-08-01T13:00:00.000Z",
};

const scheduled = new NudgeScheduledOutputEvent({
  conversationId: "conversation-nudge-output",
  id: "output-nudge-scheduled-1",
  timestamp: "2026-08-01T10:00:00.000Z",
  runId: "run-nudge-output",
  nudgeId: "nudge-1",
  policyId: "policy.progress",
  templateId: "runtime.progress",
  templateVersion: "1",
  targetTurnNumber: 5,
  ...forbiddenOptions,
});
const scheduledSnapshot = scheduled.getSnapshot();
assert.deepEqual(scheduledSnapshot, {
  id: "output-nudge-scheduled-1",
  conversationId: "conversation-nudge-output",
  eventType: OUTPUT_EVENT_TYPE.nudgeScheduled,
  schemaVersion: 1,
  timestamp: "2026-08-01T10:00:00.000Z",
  runId: "run-nudge-output",
  payload: {
    nudgeId: "nudge-1",
    policyId: "policy.progress",
    templateId: "runtime.progress",
    templateVersion: "1",
    targetTurnNumber: 5,
    state: "scheduled",
  },
});
assert.deepEqual(registry.validateOutput(scheduledSnapshot), scheduledSnapshot);

const injected = new SystemReminderInjectedOutputEvent({
  conversationId: "conversation-nudge-output",
  id: "output-reminder-injected-1",
  timestamp: "2026-08-01T10:00:01.000Z",
  runId: "run-nudge-output",
  turnId: "turn-nudge-output-5",
  nudgeId: "nudge-1",
  policyId: "policy.progress",
  templateId: "runtime.progress",
  templateVersion: "1",
  targetTurnNumber: 5,
  leaseId: "lease-1",
  providerCallId: "provider-call-1",
  ...forbiddenOptions,
});
const injectedSnapshot = injected.getSnapshot();
assert.deepEqual(injectedSnapshot, {
  id: "output-reminder-injected-1",
  conversationId: "conversation-nudge-output",
  eventType: OUTPUT_EVENT_TYPE.systemReminderInjected,
  schemaVersion: 1,
  timestamp: "2026-08-01T10:00:01.000Z",
  runId: "run-nudge-output",
  turnId: "turn-nudge-output-5",
  payload: {
    nudgeId: "nudge-1",
    policyId: "policy.progress",
    templateId: "runtime.progress",
    templateVersion: "1",
    targetTurnNumber: 5,
    leaseId: "lease-1",
    providerCallId: "provider-call-1",
    state: "consumed",
  },
});
assert.deepEqual(registry.validateOutput(injectedSnapshot), injectedSnapshot);

const expired = new NudgeExpiredOutputEvent({
  conversationId: "conversation-nudge-output",
  id: "output-nudge-expired-1",
  timestamp: "2026-08-01T10:00:02.000Z",
  runId: "run-nudge-output",
  nudgeId: "nudge-2",
  policyId: "policy.stage",
  templateId: "runtime.stage",
  templateVersion: "2",
  ...forbiddenOptions,
});
const expiredSnapshot = expired.getSnapshot();
assert.deepEqual(expiredSnapshot, {
  id: "output-nudge-expired-1",
  conversationId: "conversation-nudge-output",
  eventType: OUTPUT_EVENT_TYPE.nudgeExpired,
  schemaVersion: 1,
  timestamp: "2026-08-01T10:00:02.000Z",
  runId: "run-nudge-output",
  payload: {
    nudgeId: "nudge-2",
    policyId: "policy.stage",
    templateId: "runtime.stage",
    templateVersion: "2",
    state: "expired",
  },
});
assert.deepEqual(registry.validateOutput(expiredSnapshot), expiredSnapshot);

const serialized = JSON.stringify([
  scheduledSnapshot,
  injectedSnapshot,
  expiredSnapshot,
]);
for (const forbidden of [
  "SENSITIVE_NUDGE_PARAMETER",
  "SENSITIVE_RENDERED_REMINDER",
  "SENSITIVE_DEDUPE_TARGET",
  "parameters",
  "renderedReminder",
  "dedupeKey",
  "priority",
  "cooldownTurns",
  "expiresAt",
]) {
  assert.equal(serialized.includes(forbidden), false);
}

assert.throws(
  () =>
    new NudgeScheduledOutputEvent({
      conversationId: "conversation-nudge-output",
      runId: " ",
      nudgeId: "nudge-invalid",
      policyId: "policy.invalid",
      templateId: "runtime.invalid",
      templateVersion: "1",
    }),
  TypeError,
);
assert.throws(
  () =>
    registry.validateOutput({
      ...scheduledSnapshot,
      payload: {
        ...scheduledSnapshot.payload,
        parameters: {},
      },
    }),
  EventValidationError,
);
assert.throws(
  () =>
    registry.validateOutput({
      ...injectedSnapshot,
      payload: {
        ...injectedSnapshot.payload,
        state: "scheduled",
      },
    }),
  EventValidationError,
);
assert.throws(
  () => {
    const { runId: _runId, ...withoutRun } = expiredSnapshot;
    registry.validateOutput(withoutRun);
  },
  EventValidationError,
);
