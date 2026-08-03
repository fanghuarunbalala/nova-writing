import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

const RESULT_MARKER = "CORE_SMOKE_TEST_RESULT=";
const MONITOR_INTERVAL_MS = 10;
const scriptPath = process.argv[2];

if (typeof scriptPath !== "string" || scriptPath.length === 0) {
  throw new TypeError("Core smoke runner requires a script path");
}

const startedAt = performance.now();
const initialMemory = process.memoryUsage();
const initialUtilization = performance.eventLoopUtilization();
let previousTick = startedAt;
let maximumEventLoopLagMs = 0;
let peakRssBytes = initialMemory.rss;
let peakHeapUsedBytes = initialMemory.heapUsed;
let status = "passed";

const monitor = setInterval(() => {
  const now = performance.now();
  maximumEventLoopLagMs = Math.max(
    maximumEventLoopLagMs,
    Math.max(0, now - previousTick - MONITOR_INTERVAL_MS),
  );
  previousTick = now;
  const memory = process.memoryUsage();
  peakRssBytes = Math.max(peakRssBytes, memory.rss);
  peakHeapUsedBytes = Math.max(peakHeapUsedBytes, memory.heapUsed);
}, MONITOR_INTERVAL_MS);

try {
  await import(pathToFileURL(scriptPath).href);
} catch {
  status = "failed";
}

await new Promise((resolve) => setTimeout(resolve, MONITOR_INTERVAL_MS));
clearInterval(monitor);

if (typeof process.exitCode === "number" && process.exitCode !== 0) {
  status = "failed";
}

const completedAt = performance.now();
const finalMemory = process.memoryUsage();
const utilization = performance.eventLoopUtilization(initialUtilization);
process.stdout.write(
  `${RESULT_MARKER}${JSON.stringify({
    status,
    durationMs: completedAt - startedAt,
    maximumEventLoopLagMs,
    eventLoopUtilization: utilization.utilization,
    rssGrowthBytes: finalMemory.rss - initialMemory.rss,
    peakRssGrowthBytes: peakRssBytes - initialMemory.rss,
    heapGrowthBytes: finalMemory.heapUsed - initialMemory.heapUsed,
    peakHeapGrowthBytes: peakHeapUsedBytes - initialMemory.heapUsed,
  })}\n`,
);
process.exitCode = status === "passed" ? 0 : 1;
