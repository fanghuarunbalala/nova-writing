import assert from "node:assert/strict";
import {
  createCoreSmokeSuiteReport,
  formatCoreSmokeSuiteReport,
} from "./support/core-smoke-report.mjs";

const report = createCoreSmokeSuiteReport({
  wallDurationMs: 700,
  timeoutMs: 30_000,
  results: [
    result("alpha-smoke.mjs", "passed", 100),
    result("beta-smoke.mjs", "failed", 300, "test_failed"),
    result("gamma-smoke.mjs", "passed", 200),
  ],
});

assert.equal(report.totalTests, 3);
assert.equal(report.passedCount, 2);
assert.equal(report.failedCount, 1);
assert.equal(report.passRate, 2 / 3);
assert.equal(report.failedRate, 1 / 3);
assert.equal(report.performance.averageTestDurationMs, 200);
assert.equal(report.performance.p50TestDurationMs, 200);
assert.equal(report.performance.p95TestDurationMs, 300);
assert.equal(report.failedTests[0].test, "beta-smoke.mjs");
assert.equal(report.failedTests[0].failureKind, "test_failed");
assert.equal(report.performance.promptAssemblyLatencyMs, 0);
assert.equal(report.nudgeScenarios.retryAndDuplicateTests, 0);

const formatted = formatCoreSmokeSuiteReport(report);
assert.equal(formatted.includes("pass=66.67%"), true);
assert.equal(formatted.includes("failed=33.33%"), true);
assert.equal(formatted.includes("beta-smoke.mjs"), true);
assert.equal(formatted.includes("maximumEventLoopLag=30.00ms"), true);
assert.equal(formatted.includes("Prompt/Nudge latency:"), true);

console.log("Core smoke report smoke passed");

function result(test, status, durationMs, failureKind = null) {
  return {
    test,
    status,
    failureKind,
    durationMs,
    maximumEventLoopLagMs: durationMs / 10,
    eventLoopUtilization: 0.5,
    peakRssGrowthBytes: durationMs * 1024,
    peakHeapGrowthBytes: durationMs * 512,
    exitCode: status === "passed" ? 0 : 1,
    signal: null,
    stdoutBytes: 10,
    stderrBytes: status === "passed" ? 0 : 20,
  };
}
