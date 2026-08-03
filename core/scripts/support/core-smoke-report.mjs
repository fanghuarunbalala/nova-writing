const SLOWEST_TEST_LIMIT = 10;

export function createCoreSmokeSuiteReport({ results, wallDurationMs, timeoutMs }) {
  const passedTests = results.filter((result) => result.status === "passed");
  const failedResults = results.filter((result) => result.status === "failed");
  const durations = results.map((result) => result.durationMs);
  const eventLoopLags = results
    .map((result) => result.maximumEventLoopLagMs)
    .filter(Number.isFinite);
  const eventLoopUtilizations = results
    .map((result) => result.eventLoopUtilization)
    .filter(Number.isFinite);
  const peakRssGrowthValues = results
    .map((result) => result.peakRssGrowthBytes)
    .filter(Number.isFinite);
  const peakHeapGrowthValues = results
    .map((result) => result.peakHeapGrowthBytes)
    .filter(Number.isFinite);
  const totalTests = results.length;
  const passedCount = passedTests.length;
  const failedCount = failedResults.length;

  return {
    schemaVersion: 1,
    totalTests,
    passedCount,
    failedCount,
    passRate: ratio(passedCount, totalTests),
    failedRate: ratio(failedCount, totalTests),
    timeoutMs,
    performance: {
      wallDurationMs: round(wallDurationMs),
      cumulativeTestDurationMs: round(sum(durations)),
      averageTestDurationMs: round(average(durations)),
      p50TestDurationMs: round(percentile(durations, 0.5)),
      p95TestDurationMs: round(percentile(durations, 0.95)),
      maximumTestDurationMs: round(maximum(durations)),
      maximumEventLoopLagMs: round(maximum(eventLoopLags)),
      averageEventLoopUtilization: round(average(eventLoopUtilizations), 4),
      maximumPeakRssGrowthBytes: round(maximum(peakRssGrowthValues)),
      maximumPeakHeapGrowthBytes: round(maximum(peakHeapGrowthValues)),
    },
    slowestTests: [...results]
      .sort((left, right) => right.durationMs - left.durationMs)
      .slice(0, SLOWEST_TEST_LIMIT)
      .map(({ test, status, durationMs }) => ({
        test,
        status,
        durationMs: round(durationMs),
      })),
    failedTests: failedResults.map((result) => ({
      test: result.test,
      failureKind: result.failureKind,
      durationMs: round(result.durationMs),
      exitCode: result.exitCode,
      signal: result.signal,
      stdoutBytes: result.stdoutBytes,
      stderrBytes: result.stderrBytes,
    })),
  };
}

export function formatCoreSmokeSuiteReport(report) {
  const performance = report.performance;
  const lines = [
    "Core Smoke Suite Report",
    `Core metrics: total=${report.totalTests} passed=${report.passedCount} failed=${report.failedCount}`,
    `Rates: pass=${formatPercentage(report.passRate)} failed=${formatPercentage(report.failedRate)}`,
    [
      "Performance:",
      `wall=${formatMilliseconds(performance.wallDurationMs)}`,
      `cumulative=${formatMilliseconds(performance.cumulativeTestDurationMs)}`,
      `average=${formatMilliseconds(performance.averageTestDurationMs)}`,
      `p50=${formatMilliseconds(performance.p50TestDurationMs)}`,
      `p95=${formatMilliseconds(performance.p95TestDurationMs)}`,
      `maximum=${formatMilliseconds(performance.maximumTestDurationMs)}`,
    ].join(" "),
    [
      "Runtime metrics:",
      `maximumEventLoopLag=${formatMilliseconds(performance.maximumEventLoopLagMs)}`,
      `averageEventLoopUtilization=${performance.averageEventLoopUtilization.toFixed(4)}`,
      `maximumPeakRssGrowth=${formatMebibytes(performance.maximumPeakRssGrowthBytes)}`,
      `maximumPeakHeapGrowth=${formatMebibytes(performance.maximumPeakHeapGrowthBytes)}`,
    ].join(" "),
    "Slowest tests:",
    ...report.slowestTests.map(
      (result) => `- ${result.test} status=${result.status} duration=${formatMilliseconds(result.durationMs)}`,
    ),
    "Failed tests:",
    ...(report.failedTests.length === 0
      ? ["- none"]
      : report.failedTests.map(
          (result) =>
            `- ${result.test} kind=${result.failureKind} duration=${formatMilliseconds(result.durationMs)} exit=${String(result.exitCode)} signal=${String(result.signal)} stdoutBytes=${result.stdoutBytes} stderrBytes=${result.stderrBytes}`,
        )),
  ];
  return lines.join("\n");
}

function ratio(value, total) {
  return total === 0 ? 0 : value / total;
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function average(values) {
  return values.length === 0 ? 0 : sum(values) / values.length;
}

function maximum(values) {
  return values.length === 0 ? 0 : Math.max(...values);
}

function percentile(values, quantile) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(quantile * sorted.length) - 1);
  return sorted[index];
}

function round(value, digits = 2) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function formatPercentage(value) {
  return `${(value * 100).toFixed(2)}%`;
}

function formatMilliseconds(value) {
  return `${value.toFixed(2)}ms`;
}

function formatMebibytes(value) {
  return `${(value / 1024 / 1024).toFixed(2)}MiB`;
}
