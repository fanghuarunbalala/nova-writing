import { performance } from "node:perf_hooks";

const scripts = JSON.parse(process.argv[2] ?? "[]");
if (!Array.isArray(scripts) || scripts.length === 0) {
  throw new TypeError("Conversation simulation phase requires scripts");
}

const monitorIntervalMs = 10;
const startedAt = performance.now();
const initialMemory = process.memoryUsage();
const initialUtilization = performance.eventLoopUtilization();
let previousTick = startedAt;
let maximumEventLoopLagMs = 0;
let tickCount = 0;
let peakRssBytes = initialMemory.rss;
let peakHeapUsedBytes = initialMemory.heapUsed;

const monitor = setInterval(() => {
  const now = performance.now();
  maximumEventLoopLagMs = Math.max(
    maximumEventLoopLagMs,
    Math.max(0, now - previousTick - monitorIntervalMs),
  );
  previousTick = now;
  tickCount += 1;
  const memory = process.memoryUsage();
  peakRssBytes = Math.max(peakRssBytes, memory.rss);
  peakHeapUsedBytes = Math.max(peakHeapUsedBytes, memory.heapUsed);
}, monitorIntervalMs);

for (const [index, script] of scripts.entries()) {
  await import(new URL(`../${script}?simulation=${index}`, import.meta.url));
  await new Promise((resolve) => setImmediate(resolve));
}

clearInterval(monitor);
const completedAt = performance.now();
const finalMemory = process.memoryUsage();
const utilization = performance.eventLoopUtilization(initialUtilization);

console.log(
  `SIMULATION_METRICS=${JSON.stringify({
    durationMs: completedAt - startedAt,
    maximumEventLoopLagMs,
    eventLoopUtilization: utilization.utilization,
    tickCount,
    rssGrowthBytes: finalMemory.rss - initialMemory.rss,
    peakRssGrowthBytes: peakRssBytes - initialMemory.rss,
    heapGrowthBytes: finalMemory.heapUsed - initialMemory.heapUsed,
    peakHeapGrowthBytes: peakHeapUsedBytes - initialMemory.heapUsed,
  })}`,
);
