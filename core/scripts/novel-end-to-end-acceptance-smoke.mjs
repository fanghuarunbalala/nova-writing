import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const scenarios = Object.freeze([
  {
    id: "multi-conversation-rebase",
    script: "novel-outline-rebase-smoke.mjs",
    capabilities: [
      "multi-conversation-drafts",
      "commit",
      "stale-commit",
      "rebase",
      "conflict",
      "conflict-resolution",
      "operation-replay",
    ],
  },
  {
    id: "approval-persistence",
    script: "novel-approval-smoke.mjs",
    capabilities: ["approval", "approval-persistence"],
  },
  {
    id: "approval-commit-orchestration",
    script: "novel-approval-commit-orchestrator-smoke.mjs",
    capabilities: ["approval-commit", "approval-staleness"],
  },
  {
    id: "outline-application",
    script: "novel-outline-application-smoke.mjs",
    capabilities: ["outline", "draft-scope-isolation"],
  },
  {
    id: "publication-application",
    script: "novel-publication-application-smoke.mjs",
    capabilities: ["publication", "publication-restart"],
  },
  {
    id: "manuscript-application",
    script: "novel-manuscript-application-smoke.mjs",
    capabilities: ["manuscript", "structural-repair", "repair-restart"],
  },
  {
    id: "evidence-application",
    script: "novel-evidence-application-smoke.mjs",
    capabilities: [
      "cross-domain-application",
      "realization",
      "completion-admission",
      "revision-staleness",
    ],
  },
  {
    id: "five-phase-restart-recovery",
    script: "node-novel-restart-recovery-smoke.mjs",
    capabilities: [
      "commit-recovery",
      "rebase-recovery",
      "draft-recovery",
      "projection-rebuild",
      "outbox-replay",
      "restart-idempotency",
    ],
  },
  {
    id: "journal-publication",
    script: "novel-outbox-journal-integration-smoke.mjs",
    capabilities: ["journal-integration", "output-event-replay"],
  },
]);

const requiredCapabilities = new Set([
  "multi-conversation-drafts",
  "commit",
  "stale-commit",
  "rebase",
  "conflict",
  "conflict-resolution",
  "operation-replay",
  "approval",
  "approval-persistence",
  "approval-commit",
  "approval-staleness",
  "outline",
  "draft-scope-isolation",
  "publication",
  "publication-restart",
  "manuscript",
  "structural-repair",
  "repair-restart",
  "cross-domain-application",
  "realization",
  "completion-admission",
  "revision-staleness",
  "commit-recovery",
  "rebase-recovery",
  "draft-recovery",
  "projection-rebuild",
  "outbox-replay",
  "restart-idempotency",
  "journal-integration",
  "output-event-replay",
]);

const coveredCapabilities = new Set(
  scenarios.flatMap((scenario) => scenario.capabilities),
);
assert.deepEqual(
  [...coveredCapabilities].sort(),
  [...requiredCapabilities].sort(),
);

for (const scenario of scenarios) {
  const result = spawnSync(process.execPath, [join(scriptsDirectory, scenario.script)], {
    cwd: dirname(scriptsDirectory),
    encoding: "utf8",
    timeout: 20_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(
    result.status,
    0,
    `Novel acceptance scenario failed: ${scenario.id}`,
  );
}

console.log(
  `novel end-to-end acceptance passed scenarios=${scenarios.length} capabilities=${requiredCapabilities.size}`,
);
