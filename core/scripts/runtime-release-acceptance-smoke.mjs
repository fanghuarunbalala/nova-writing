import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { OUTPUT_EVENT_TYPE } from "../dist/index.js";

const references = [
  "core-smoke-suite.mjs",
  "core-smoke-report-smoke.mjs",
  "local-conversation-integration-smoke.mjs",
  "conversation-host-sqlite-integration-smoke.mjs",
  "runtime-host-child-integration-smoke.mjs",
  "conversation-event-integration-smoke.mjs",
  "tool-approval-events-smoke.mjs",
  "runtime-pi-nudge-overlay-integration-smoke.mjs",
  "runtime-context-compaction-manager-smoke.mjs",
  "runtime-subagent-host-sqlite-integration-smoke.mjs",
  "runtime-conversation-manifest-recovery-smoke.mjs",
  "runtime-manifest-backed-child-composition-smoke.mjs",
  "runtime-client-adaptation-smoke.mjs",
  "runtime-conversation-complete-simulation-smoke.mjs",
];

for (const reference of references) await access(new URL(reference, import.meta.url));
await access(new URL("./fixtures/core-smoke-test-runner.mjs", import.meta.url));
await access(new URL("./support/core-smoke-report.mjs", import.meta.url));
await access(new URL("../../docs/runtime-client-integration.md", import.meta.url));
await access(new URL("../../docs/runtime-validation-matrix.md", import.meta.url));

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
for (const script of ["smoke:all", "smoke:report", "smoke:runtime-ipc-protocol", "smoke:runtime-subagent-host-sqlite", "smoke:tool-execution-integration", "smoke:runtime-conversation-complete"]) {
  assert.equal(typeof packageJson.scripts[script], "string");
}
assert.equal(OUTPUT_EVENT_TYPE.subagentCompleted, "agent.subagent.completed");
assert.equal(OUTPUT_EVENT_TYPE.toolApprovalRequested, "system.tool.approval.requested");

console.log("Runtime release acceptance smoke passed");
