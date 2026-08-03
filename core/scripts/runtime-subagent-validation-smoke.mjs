/** Runs the complete ephemeral Subagent validation slice with one redacted report. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { formatCoreSmokeSuiteReport } from "./support/core-smoke-report.mjs";

const SUITE_TIMEOUT_MS = 120_000;
const REPORT_MARKER = "CORE_SMOKE_SUITE_REPORT=";
const tests = [
  "runtime-subagent-protocol-smoke.mjs",
  "runtime-subagent-task-protocol-smoke.mjs",
  "runtime-subagent-task-assigned-smoke.mjs",
  "runtime-subagent-manager-smoke.mjs",
  "runtime-subagent-bootstrap-smoke.mjs",
  "runtime-subagent-lifecycle-smoke.mjs",
  "runtime-subagent-recovery-tree-smoke.mjs",
  "runtime-subagent-task-query-bridge-smoke.mjs",
  "runtime-subagent-task-tools-smoke.mjs",
  "runtime-subagent-host-sqlite-integration-smoke.mjs",
  "runtime-ipc-protocol-smoke.mjs",
  "runtime-ipc-peer-smoke.mjs",
  "runtime-ipc-jsonl-smoke.mjs",
  "runtime-agent-no-process-integration-smoke.mjs",
  "runtime-host-child-integration-smoke.mjs",
];

const suitePath = fileURLToPath(new URL("./core-smoke-suite.mjs", import.meta.url));
const child = spawn(process.execPath, [suitePath, ...tests], {
  cwd: fileURLToPath(new URL("..", import.meta.url)),
  stdio: ["ignore", "pipe", "ignore"],
});
let stdout = "";
child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  stdout = `${stdout}${chunk}`.slice(-1024 * 1024);
});

const timeout = setTimeout(() => child.kill("SIGKILL"), SUITE_TIMEOUT_MS);
const exit = await new Promise((resolve) => {
  child.once("error", () => resolve({ code: 1, signal: null }));
  child.once("exit", (code, signal) => resolve({ code, signal }));
});
clearTimeout(timeout);

const reportLine = stdout
  .split("\n")
  .findLast((line) => line.startsWith(REPORT_MARKER));
assert.ok(reportLine, "Subagent validation did not produce a Core Smoke report");
const report = JSON.parse(reportLine.slice(REPORT_MARKER.length));
assert.deepEqual(report.totalTests, tests.length);
assert.equal(report.failedCount, 0, formatCoreSmokeSuiteReport(report));
assert.equal(exit.code, 0, `Subagent validation exited with ${String(exit.code)}`);
assert.equal(exit.signal, null, "Subagent validation was terminated");
assert.ok(Number.isFinite(report.performance.p95TestDurationMs));
assert.ok(Number.isFinite(report.performance.maximumEventLoopLagMs));
assert.ok(Number.isFinite(report.performance.averageEventLoopUtilization));

console.log(formatCoreSmokeSuiteReport(report));
console.log(`SUBAGENT_VALIDATION_REPORT=${JSON.stringify(report)}`);
