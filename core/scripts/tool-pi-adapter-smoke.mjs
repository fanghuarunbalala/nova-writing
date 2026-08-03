import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Type } from "typebox";
import {
  ARTIFACT_REFERENCE_SCHEMA_VERSION,
  captureToolExecutionUpdate,
  captureToolResult,
  defineTool,
} from "../dist/index.js";
import { PiToolAdapter } from "../dist/runtime/agent/pi/PiToolAdapter.js";

const requests = [];
const bridge = Object.freeze({
  async execute(request) {
    requests.push(request);
    await request.progress.emit(
      captureToolExecutionUpdate({
        kind: "progress",
        message: "Searching",
        completed: 1,
        total: 2,
      }),
    );
    await request.progress.emit(
      captureToolExecutionUpdate({
        kind: "partial_result",
        content: [{ type: "text", text: "partial" }],
      }),
    );
    return captureToolResult(
      {
        content: [{ type: "text", text: "final" }],
        details: { matches: 2 },
        artifacts: [
          {
            schemaVersion: ARTIFACT_REFERENCE_SCHEMA_VERSION,
            artifactId: "artifact-1",
            conversationId: "conversation-1",
            contentType: "text/plain",
            byteLength: 5,
            digest: `sha256:${"0".repeat(64)}`,
          },
        ],
      },
      {
        conversationId: "conversation-1",
        toolCallId: request.toolCallId,
        toolName: request.tool.descriptor.name,
        toolVersion: request.tool.descriptor.version,
        limits: {
          maximumContentBlocks: 4,
          maximumTextBytes: 1024,
          maximumDetailsBytes: 1024,
          maximumArtifactReferences: 4,
        },
      },
    );
  },
});
const parameters = Type.Object({ query: Type.String() });
const registered = defineTool({
  descriptor: {
    name: "SearchNovel",
    version: "1.0.0",
    label: "Search novel",
    description: "Searches Novel content.",
    parameters,
  },
  handler: {
    async execute() {
      throw new Error("Pi adapter must not call the Handler directly");
    },
  },
});

const adapter = new PiToolAdapter(bridge);
const piTool = adapter.toAgentTool(registered);
assert.equal(Object.isFrozen(piTool), true);
assert.equal(piTool.name, "SearchNovel");
assert.equal(piTool.label, "Search novel");
assert.equal(piTool.description, "Searches Novel content.");
assert.equal(piTool.parameters, registered.descriptor.parameters);

const controller = new AbortController();
const updates = [];
const result = await piTool.execute(
  "tool-call-1",
  { query: "hero" },
  controller.signal,
  (update) => updates.push(update),
);
assert.equal(requests.length, 1);
assert.equal(requests[0].tool, registered);
assert.equal(requests[0].toolCallId, "tool-call-1");
assert.deepEqual(requests[0].arguments, { query: "hero" });
assert.equal(requests[0].signal, controller.signal);
assert.deepEqual(updates, [
  {
    content: [{ type: "text", text: "Searching" }],
    details: { kind: "progress", completed: 1, total: 2 },
  },
  {
    content: [{ type: "text", text: "partial" }],
    details: { kind: "partial_result" },
  },
]);
assert.deepEqual(result, {
  content: [{ type: "text", text: "final" }],
  details: {
    kind: "result",
    details: { matches: 2 },
    artifacts: [
      {
        schemaVersion: ARTIFACT_REFERENCE_SCHEMA_VERSION,
        artifactId: "artifact-1",
        conversationId: "conversation-1",
        contentType: "text/plain",
        byteLength: 5,
        digest: `sha256:${"0".repeat(64)}`,
      },
    ],
  },
});

await adapter.toAgentTool(registered).execute("tool-call-2", { query: "villain" });
assert.equal(requests[1].signal instanceof AbortSignal, true);
assert.equal(requests[1].signal.aborted, false);

const ordered = adapter.toAgentTools([registered, defineTool({
  descriptor: {
    name: "SubmitResult",
    version: "1.0.0",
    label: "Submit",
    description: "Submits a result.",
    parameters: Type.Object({}),
  },
  handler: registered.handler,
})]);
assert.equal(Object.isFrozen(ordered), true);
assert.deepEqual(ordered.map((tool) => tool.name), [
  "SearchNovel",
  "SubmitResult",
]);

const bridgeFailure = new Error("bridge failure");
const failingTool = new PiToolAdapter({
  async execute() {
    throw bridgeFailure;
  },
}).toAgentTool(registered);
await assert.rejects(
  () => failingTool.execute("tool-call-3", { query: "failure" }),
  (error) => error === bridgeFailure,
);

const publicDeclarations = await Promise.all([
  "index.d.ts",
  "tools/index.d.ts",
  "runtime/index.d.ts",
  "runtime/agent/index.d.ts",
].map((path) => readFile(join(process.cwd(), "dist", path), "utf8")));
for (const declaration of publicDeclarations) {
  assert.equal(declaration.includes("PiToolAdapter"), false);
  assert.equal(declaration.includes("PiToolExecutionBridge"), false);
  assert.equal(declaration.includes("@earendil-works/pi-agent-core"), false);
}
const internalPiIndex = await readFile(
  join(process.cwd(), "dist", "runtime", "agent", "pi", "index.d.ts"),
  "utf8",
);
assert.equal(internalPiIndex.includes("PiToolAdapter"), false);

console.log("tool Pi adapter smoke passed");
