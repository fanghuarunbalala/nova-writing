import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import {
  createCoreSmokeSuiteReport,
  formatCoreSmokeSuiteReport,
} from "./support/core-smoke-report.mjs";

const TEST_TIMEOUT_MS = 30_000;
const MAXIMUM_CAPTURED_OUTPUT_BYTES = 1024 * 1024;
const RESULT_MARKER = "CORE_SMOKE_TEST_RESULT=";
const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const coreDirectory = dirname(scriptsDirectory);
const testRunnerPath = join(
  scriptsDirectory,
  "fixtures",
  "core-smoke-test-runner.mjs",
);

const availableTests = (await readdir(scriptsDirectory, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith("-smoke.mjs"))
  .map((entry) => entry.name)
  .sort();
const requestedTests = process.argv.slice(2);
const tests = requestedTests.length === 0 ? availableTests : requestedTests;

for (const test of tests) {
  if (!availableTests.includes(test)) {
    throw new TypeError("Core smoke suite received an unknown test name");
  }
}

const suiteStartedAt = performance.now();
const results = [];
for (const [index, test] of tests.entries()) {
  results.push(await runTest(test));
  if ((index + 1) % 10 === 0 || index + 1 === tests.length) {
    console.log(`Core smoke progress completed=${index + 1} total=${tests.length}`);
  }
}

const report = createCoreSmokeSuiteReport({
  results,
  wallDurationMs: performance.now() - suiteStartedAt,
  timeoutMs: TEST_TIMEOUT_MS,
});
console.log(formatCoreSmokeSuiteReport(report));
console.log(`CORE_SMOKE_SUITE_REPORT=${JSON.stringify(report)}`);
process.exitCode = report.failedCount === 0 ? 0 : 1;

async function runTest(test) {
  const startedAt = performance.now();
  const useProcessGroup = process.platform !== "win32";
  const child = spawn(
    process.execPath,
    [testRunnerPath, join(scriptsDirectory, test)],
    {
      cwd: coreDirectory,
      detached: useProcessGroup,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stdout = "";
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let timedOut = false;
  let spawnFailed = false;

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdoutBytes += Buffer.byteLength(chunk, "utf8");
    stdout = appendBounded(stdout, chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderrBytes += Buffer.byteLength(chunk, "utf8");
  });

  const timeout = setTimeout(() => {
    timedOut = true;
    killChild(child, useProcessGroup);
  }, TEST_TIMEOUT_MS);
  const processResult = await new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    child.once("error", () => {
      spawnFailed = true;
      finish({ exitCode: 1, signal: null });
    });
    child.once("exit", (exitCode, signal) => finish({ exitCode, signal }));
  });
  clearTimeout(timeout);

  const workerReport = parseWorkerReport(stdout);
  const failureKind = classifyFailure({
    timedOut,
    spawnFailed,
    workerReport,
    exitCode: processResult.exitCode,
  });
  return {
    test,
    status: failureKind === null ? "passed" : "failed",
    failureKind,
    durationMs:
      workerReport?.durationMs ?? performance.now() - startedAt,
    maximumEventLoopLagMs: workerReport?.maximumEventLoopLagMs,
    eventLoopUtilization: workerReport?.eventLoopUtilization,
    peakRssGrowthBytes: workerReport?.peakRssGrowthBytes,
    peakHeapGrowthBytes: workerReport?.peakHeapGrowthBytes,
    exitCode: processResult.exitCode,
    signal: processResult.signal,
    stdoutBytes,
    stderrBytes,
  };
}

function parseWorkerReport(stdout) {
  const line = stdout
    .split("\n")
    .findLast((candidate) => candidate.startsWith(RESULT_MARKER));
  if (line === undefined) return undefined;
  try {
    return JSON.parse(line.slice(RESULT_MARKER.length));
  } catch {
    return undefined;
  }
}

function classifyFailure({ timedOut, spawnFailed, workerReport, exitCode }) {
  if (timedOut) return "timeout";
  if (spawnFailed) return "spawn_failed";
  if (workerReport === undefined) return "missing_report";
  if (workerReport.status !== "passed") return "test_failed";
  if (exitCode !== 0) return "nonzero_exit";
  return null;
}

function killChild(child, useProcessGroup) {
  try {
    if (useProcessGroup && typeof child.pid === "number") {
      process.kill(-child.pid, "SIGKILL");
      return;
    }
    child.kill("SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}

function appendBounded(current, chunk) {
  const combined = current + chunk;
  return combined.length <= MAXIMUM_CAPTURED_OUTPUT_BYTES
    ? combined
    : combined.slice(combined.length - MAXIMUM_CAPTURED_OUTPUT_BYTES);
}
