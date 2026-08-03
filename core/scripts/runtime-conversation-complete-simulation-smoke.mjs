import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const PHASE_TIMEOUT_MS = 30_000;
const MAXIMUM_PHASE_DURATION_MS = 15_000;
const MAXIMUM_EVENT_LOOP_LAG_MS = 1_000;
const MAXIMUM_PEAK_RSS_GROWTH_BYTES = 256 * 1024 * 1024;

const phases = [
  {
    name: "conversation_input_output",
    capabilities: ["input_events", "output_events", "single_process"],
    scripts: [
      "conversation-protocol-smoke.mjs",
      "conversation-command-integration-smoke.mjs",
      "conversation-output-protocol-smoke.mjs",
      "conversation-output-publishing-smoke.mjs",
      "runtime-input-router-smoke.mjs",
      "runtime-agent-no-process-integration-smoke.mjs",
      "conversation-event-integration-smoke.mjs",
    ],
  },
  {
    name: "context_prompt_nudge",
    capabilities: ["context_compaction", "nudge", "system_prompt"],
    scripts: [
      "runtime-context-compaction-manager-smoke.mjs",
      "runtime-context-compaction-events-smoke.mjs",
      "runtime-pi-context-projection-integration-smoke.mjs",
      "runtime-pi-nudge-overlay-integration-smoke.mjs",
    ],
  },
  {
    name: "tool_registration_execution",
    capabilities: ["tool_registration", "tool_execution"],
    scripts: [
      "tool-registry-integration-smoke.mjs",
      "tool-execution-integration-smoke.mjs",
    ],
  },
  {
    name: "subagent_single_process",
    capabilities: ["subagent", "single_process"],
    scripts: [
      "runtime-subagent-lifecycle-smoke.mjs",
      "runtime-subagent-recovery-tree-smoke.mjs",
    ],
  },
  {
    name: "ipc_child_process",
    capabilities: ["ipc", "child_process"],
    scripts: [
      "runtime-ipc-peer-smoke.mjs",
      "runtime-host-child-integration-smoke.mjs",
    ],
  },
  {
    name: "subagent_persisted_host",
    capabilities: ["subagent", "persistence", "host"],
    scripts: [
      "runtime-subagent-host-sqlite-integration-smoke.mjs",
      "runtime-conversation-manifest-recovery-smoke.mjs",
      "runtime-manifest-backed-child-composition-smoke.mjs",
    ],
  },
  {
    name: "client_portability",
    capabilities: ["client_portability", "replay", "single_process"],
    scripts: [
      "runtime-client-adaptation-smoke.mjs",
      "mock-client-transports-smoke.mjs",
      "conversation-projection-controller-smoke.mjs",
    ],
  },
];

const requiredCapabilities = new Set([
  "input_events",
  "output_events",
  "context_compaction",
  "nudge",
  "tool_registration",
  "tool_execution",
  "system_prompt",
  "subagent",
  "ipc",
  "single_process",
  "child_process",
  "replay",
  "client_portability",
]);
const coveredCapabilities = new Set(
  phases.flatMap((phase) => phase.capabilities),
);
for (const capability of requiredCapabilities) {
  assert.equal(
    coveredCapabilities.has(capability),
    true,
    `missing complete simulation capability ${capability}`,
  );
}

const summaries = [];
for (const phase of phases) {
  const result = await runPhase(phase);
  assert.equal(
    result.exitCode,
    0,
    `${phase.name} failed with redacted child output (${result.stdoutBytes} stdout bytes, ${result.stderrBytes} stderr bytes)`,
  );
  assert.ok(
    result.metrics.durationMs <= MAXIMUM_PHASE_DURATION_MS,
    `${phase.name} exceeded duration guard`,
  );
  assert.ok(
    result.metrics.maximumEventLoopLagMs <= MAXIMUM_EVENT_LOOP_LAG_MS,
    `${phase.name} exceeded event-loop blocking guard`,
  );
  assert.ok(
    result.metrics.peakRssGrowthBytes <= MAXIMUM_PEAK_RSS_GROWTH_BYTES,
    `${phase.name} exceeded memory growth guard`,
  );
  assert.ok(
    result.metrics.tickCount > 0,
    `${phase.name} did not sample Event Loop responsiveness`,
  );
  summaries.push({
    phase: phase.name,
    durationMs: Math.round(result.metrics.durationMs),
    maximumEventLoopLagMs: Math.round(
      result.metrics.maximumEventLoopLagMs,
    ),
    eventLoopUtilization: Number(
      result.metrics.eventLoopUtilization.toFixed(4),
    ),
    peakRssGrowthMiB: Number(
      (result.metrics.peakRssGrowthBytes / 1024 / 1024).toFixed(2),
    ),
  });
}

console.log(`Conversation complete simulation metrics ${JSON.stringify(summaries)}`);
console.log("Runtime Conversation complete simulation smoke passed");

async function runPhase(phase) {
  const runner = fileURLToPath(
    new URL(
      "./fixtures/runtime-conversation-simulation-phase-runner.mjs",
      import.meta.url,
    ),
  );
  const child = spawn(process.execPath, [runner, JSON.stringify(phase.scripts)], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stdoutBytes = 0;
  let stderrBytes = 0;
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdoutBytes += Buffer.byteLength(chunk, "utf8");
    stdout = appendBounded(stdout, chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderrBytes += Buffer.byteLength(chunk, "utf8");
  });

  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, PHASE_TIMEOUT_MS);
  const exitCode = await new Promise((resolve) => {
    child.once("error", () => resolve(1));
    child.once("exit", (code) => resolve(code ?? 1));
  });
  clearTimeout(timeout);
  assert.equal(timedOut, false, `${phase.name} blocked past hard timeout`);

  const metricsLine = stdout
    .split("\n")
    .find((line) => line.startsWith("SIMULATION_METRICS="));
  assert.ok(metricsLine, `${phase.name} did not report performance metrics`);
  return {
    exitCode,
    metrics: JSON.parse(metricsLine.slice("SIMULATION_METRICS=".length)),
    stdoutBytes,
    stderrBytes,
  };
}

function appendBounded(current, chunk) {
  const combined = current + chunk;
  return combined.length <= 1024 * 1024
    ? combined
    : combined.slice(combined.length - 1024 * 1024);
}
