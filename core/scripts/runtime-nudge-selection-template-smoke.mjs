import assert from "node:assert/strict";
import {
  NUDGE_DELIVERY,
  NUDGE_PLACEMENT,
  NUDGE_SELECTION_FAILURE,
  NUDGE_TEMPLATE_FAILURE,
  NudgeRenderer,
  NudgeSelectionError,
  NudgeSelector,
  NudgeTemplateError,
  NudgeTemplateRegistry,
  PENDING_NUDGE_STATE,
} from "../dist/index.js";

const logs = [];
const logger = {
  debug: (event, fields) => logs.push({ level: "debug", event, fields }),
  info: (event, fields) => logs.push({ level: "info", event, fields }),
  warn: (event, fields) => logs.push({ level: "warn", event, fields }),
  error: (event, fields) => logs.push({ level: "error", event, fields }),
  child: () => logger,
};

function pending(overrides = {}) {
  return {
    id: "nudge-default",
    policyId: "policy.default",
    templateId: "runtime.reminder",
    templateVersion: "1",
    priority: 10,
    dedupeKey: "default",
    parameters: { privateValue: "SENSITIVE_PARAMETER" },
    exclusive: false,
    placement: NUDGE_PLACEMENT.systemPromptOverlay,
    delivery: NUDGE_DELIVERY.once,
    state: PENDING_NUDGE_STATE.scheduled,
    targetRunId: "run-1",
    scheduledSequence: 10,
    scheduledAt: "2026-08-01T09:00:00.000Z",
    ...overrides,
  };
}

const request = {
  providerCallId: "provider-call-1",
  targetRunId: "run-1",
  targetTurnNumber: 5,
  requestedAt: "2026-08-01T10:00:00.000Z",
};
const selector = new NudgeSelector({ logger });
const candidates = [
  pending({
    id: "wrong-run",
    targetRunId: "run-2",
    priority: 100,
    scheduledSequence: 1,
  }),
  pending({
    id: "expired-time",
    expiresAt: "2026-08-01T10:00:00.000Z",
    priority: 100,
    scheduledSequence: 2,
  }),
  pending({
    id: "expired-turn",
    expiresAfterTurn: 4,
    priority: 100,
    scheduledSequence: 3,
  }),
  pending({
    id: "cooldown",
    dedupeKey: "cooldown-key",
    cooldownTurns: 1,
    priority: 100,
    scheduledSequence: 4,
  }),
  pending({ id: "priority-first", priority: 50, scheduledSequence: 30 }),
  pending({ id: "sequence-first", priority: 20, scheduledSequence: 11 }),
  pending({ id: "sequence-second", priority: 20, scheduledSequence: 12 }),
];

assert.deepEqual(
  selector
    .select(candidates, request, [
      { dedupeKey: "cooldown-key", consumedTurnNumber: 4 },
    ])
    .map((nudge) => nudge.id),
  ["priority-first"],
);
assert.deepEqual(
  selector
    .select(candidates, { ...request, requestedLimit: 2 }, [
      { dedupeKey: "cooldown-key", consumedTurnNumber: 4 },
    ])
    .map((nudge) => nudge.id),
  ["priority-first", "sequence-first"],
);
assert.deepEqual(
  selector
    .select(
      [
        pending({
          id: "exclusive",
          exclusive: true,
          priority: 100,
          scheduledSequence: 1,
        }),
        pending({ id: "other", priority: 90, scheduledSequence: 2 }),
      ],
      { ...request, requestedLimit: 2 },
    )
    .map((nudge) => nudge.id),
  ["exclusive"],
);
assert.deepEqual(
  selector
    .select(
      [
        pending({ id: "normal", priority: 100, scheduledSequence: 1 }),
        pending({
          id: "later-exclusive",
          exclusive: true,
          priority: 90,
          scheduledSequence: 2,
        }),
        pending({ id: "later-normal", priority: 80, scheduledSequence: 3 }),
      ],
      { ...request, requestedLimit: 2 },
    )
    .map((nudge) => nudge.id),
  ["normal"],
);
assert.throws(
  () => selector.select(candidates, request, [{ dedupeKey: "bad", consumedTurnNumber: 0 }]),
  (error) =>
    error instanceof NudgeSelectionError &&
    error.failure === NUDGE_SELECTION_FAILURE.invalidCooldown,
);
assert.throws(
  () =>
    selector.select(
      [pending({ id: "duplicate-sequence-1" }), pending({ id: "duplicate-sequence-2" })],
      request,
    ),
  (error) =>
    error instanceof NudgeSelectionError &&
    error.failure === NUDGE_SELECTION_FAILURE.invalidCandidate,
);

const templates = new NudgeTemplateRegistry({ logger });
templates.register({
  templateId: "runtime.reminder",
  templateVersion: "1",
  render: (parameters) => `SENSITIVE_RENDERED_REMINDER:${parameters.privateValue}`,
});
templates.register({
  templateId: "runtime.reminder",
  templateVersion: "2",
  render: () => "version two",
});
assert.equal(templates.resolve("runtime.reminder", "2").templateVersion, "2");
assert.throws(
  () =>
    templates.register({
      templateId: "runtime.reminder",
      templateVersion: "1",
      render: () => "duplicate",
    }),
  (error) =>
    error instanceof NudgeTemplateError &&
    error.failure === NUDGE_TEMPLATE_FAILURE.duplicateTemplate,
);
assert.throws(
  () => templates.resolve("runtime.reminder", "missing"),
  (error) =>
    error instanceof NudgeTemplateError &&
    error.failure === NUDGE_TEMPLATE_FAILURE.templateNotFound,
);

const renderer = new NudgeRenderer({ templates, logger });
const overlay = renderer.render([
  pending({ id: "render-1", state: PENDING_NUDGE_STATE.leased }),
  pending({
    id: "render-2",
    state: PENDING_NUDGE_STATE.leased,
    templateVersion: "2",
  }),
]);
assert.equal(overlay.placement, NUDGE_PLACEMENT.systemPromptOverlay);
assert.deepEqual(overlay.nudgeIds, ["render-1", "render-2"]);
assert.equal(
  overlay.content,
  "SENSITIVE_RENDERED_REMINDER:SENSITIVE_PARAMETER\n\nversion two",
);
assert.throws(
  () =>
    renderer.render([
      pending({ id: "duplicate", state: PENDING_NUDGE_STATE.leased }),
      pending({ id: "duplicate", state: PENDING_NUDGE_STATE.leased }),
    ]),
  (error) =>
    error instanceof NudgeTemplateError &&
    error.failure === NUDGE_TEMPLATE_FAILURE.invalidNudges,
);

templates.register({
  templateId: "runtime.blank",
  templateVersion: "1",
  render: () => "   ",
});
assert.throws(
  () =>
    renderer.render([
      pending({
        id: "blank",
        state: PENDING_NUDGE_STATE.leased,
        templateId: "runtime.blank",
      }),
    ]),
  (error) =>
    error instanceof NudgeTemplateError &&
    error.failure === NUDGE_TEMPLATE_FAILURE.invalidRenderedOutput,
);

const serializedLogs = JSON.stringify(logs);
assert.equal(serializedLogs.includes("SENSITIVE_PARAMETER"), false);
assert.equal(serializedLogs.includes("SENSITIVE_RENDERED_REMINDER"), false);
assert.equal(
  logs.some((record) => record.event === "runtime.nudge.selection_completed"),
  true,
);
assert.equal(
  logs.some((record) => record.event === "runtime.nudge.render_completed"),
  true,
);
