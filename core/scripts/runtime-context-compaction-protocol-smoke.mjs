import assert from "node:assert/strict";
import {
  ARTIFACT_REFERENCE_SCHEMA_VERSION,
  CONTEXT_BUDGET_DEFAULTS,
  CONTEXT_CHECKPOINT_ITEM_PRIORITY,
  CONTEXT_CHECKPOINT_SCHEMA_VERSION,
  CONTEXT_COMPACTION_OUTCOME,
  CONTEXT_PIN_GROUP_KIND,
  CONTEXT_PIN_LIFETIME,
  CONTEXT_PRESSURE_LEVEL,
  CONTEXT_PROJECTION_DEGRADATION_LEVEL,
  CONTEXT_UNREDUCIBLE_REASON,
} from "../dist/index.js";

assert.deepEqual(CONTEXT_BUDGET_DEFAULTS, {
  softReminderRatio: 0.7,
  compactionRequestRatio: 0.82,
  targetPostCompactionRatio: 0.55,
  hardAdmissionRatio: 0.92,
  minimumNewContentRatio: 0.1,
  minimumNewContentTokens: 8_192,
  minimumSavingsRatio: 0.05,
  minimumSavingsTokens: 2_048,
});

assert.equal(ARTIFACT_REFERENCE_SCHEMA_VERSION, 1);
assert.equal(CONTEXT_CHECKPOINT_SCHEMA_VERSION, 1);
assert.deepEqual(Object.values(CONTEXT_PRESSURE_LEVEL), [
  "normal",
  "soft",
  "compaction",
  "hard",
]);
assert.deepEqual(Object.values(CONTEXT_COMPACTION_OUTCOME), [
  "target_met",
  "reduced",
  "degraded",
  "unreducible",
]);
assert.deepEqual(Object.values(CONTEXT_PIN_LIFETIME), [
  "permanent",
  "conditional",
  "sliding",
]);
assert.deepEqual(Object.values(CONTEXT_CHECKPOINT_ITEM_PRIORITY), [
  "critical",
  "high",
  "normal",
  "low",
]);
assert.deepEqual(CONTEXT_PROJECTION_DEGRADATION_LEVEL, {
  none: 0,
  strongerStructured: 1,
  artifactOffload: 2,
  priorityBudgeted: 3,
  recentWindowReduced: 4,
});
assert.equal(CONTEXT_PIN_GROUP_KIND.activeToolExecution, "active_tool_execution");
assert.equal(
  CONTEXT_UNREDUCIBLE_REASON.compactionInsufficient,
  "compaction_insufficient",
);
