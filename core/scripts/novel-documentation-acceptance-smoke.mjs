import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const implementationPlan = await read("docs/novel-implementation-plan.md");
const domain = await read("docs/novel-domain.md");
const architecture = await read("docs/architecture.md");

for (const marker of [
  "**Task N11-D and Task N11 are\ncomplete.**",
  "### N10–N11 Completion Evidence",
  "**Novel Task N0 through Task N11 is complete.**",
  "Agent-facing Novel Tools remain deferred beyond Task N11.",
]) {
  assert.equal(implementationPlan.includes(marker), true, marker);
}
for (const marker of [
  "### 12.2 Public Application Facade",
  "class NovelEvidenceService",
  "### 12.10 Platform-Neutral Application Examples",
  "await application.paragraphs.replaceText",
  "await application.evidenceQueries.evaluateCompletion",
  "participant Client as \"CLI / GUI / Web\"",
  "### 12.11 Explicit Exclusions",
  "### 12.12 External Consumption Contract",
  "@novel/core/node",
  "NodeNovelWorkspaceHost",
]) {
  assert.equal(domain.includes(marker), true, marker);
}
for (const marker of [
  "## 30. Completed Novel Application Boundary",
  "Commit → Rebase → Draft → Projection → Outbox",
  "Trusted Node Host / Web Backend",
  "core/scripts/novel-end-to-end-acceptance-smoke.mjs",
]) {
  assert.equal(architecture.includes(marker), true, marker);
}
for (const stale of [
  "Task N11-B Recovery is next.",
  "Dedicated Novel domain implementation, tracked separately",
]) {
  assert.equal(
    `${implementationPlan}\n${architecture}`.includes(stale),
    false,
    stale,
  );
}

const examples = domain.slice(
  domain.indexOf("### 12.10 Platform-Neutral Application Examples"),
  domain.indexOf("### 12.11 Explicit Exclusions"),
);
assert.equal(examples.includes("node:"), false);
assert.equal(examples.includes("Sqlite"), false);
assert.equal(examples.includes("Agent Tool"), false);

for (const [name, value] of Object.entries({ implementationPlan, domain, architecture })) {
  assertMermaidFences(name, value);
}

console.log("novel documentation acceptance smoke passed");

async function read(relativePath) {
  // 行尾无关：`core.autocrlf` 在 Windows 检出会把 LF 文档转成 CRLF，导致
  // 跨行 marker 的字面 `\n` 匹配失败。读入时统一归一化为 LF。
  // Line-ending agnostic: autocrlf checks out LF docs as CRLF on Windows,
  // which breaks literal `\n` markers. Normalize to LF on read.
  return (await readFile(join(repositoryRoot, relativePath), "utf8")).replace(
    /\r\n/g,
    "\n",
  );
}

function assertMermaidFences(name, value) {
  const lines = value.split("\n");
  let inFence = false;
  let mermaidFenceCount = 0;
  for (const line of lines) {
    if (!inFence && line.trim() === "```mermaid") {
      inFence = true;
      mermaidFenceCount += 1;
      continue;
    }
    if (inFence && line.trim() === "```") inFence = false;
  }
  assert.equal(inFence, false, `${name} has an unclosed Mermaid fence`);
  assert.equal(mermaidFenceCount > 0, true, `${name} has no Mermaid diagrams`);
}
