import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Type } from "typebox";
import {
  TOOL_REGISTRY_VIEW_FAILURE,
  ToolGroupCatalog,
  ToolRegistryAssembler,
  ToolRegistryView,
  ToolRegistryViewError,
  captureToolExecutionUpdate,
  captureToolResult,
  defineTool,
  loadToolGroupManifest,
} from "../dist/index.js";
import { PiToolAdapter } from "../dist/runtime/agent/pi/PiToolAdapter.js";

const handler = Object.freeze({
  async execute() {
    throw new Error("Checkpoint 5A must route execution through the bridge");
  },
});
const registered = [
  tool("submit_result", "3.0.0"),
  tool("read_file", "1.1.0"),
  tool("search_novel", "2.0.0"),
  tool("write_file", "1.0.0"),
];
const assembler = new ToolRegistryAssembler();
for (const toolValue of registered) assembler.register(toolValue);
const registry = assembler.freeze();
assert.deepEqual(registry.list().map(identity), [
  "read_file@1.1.0",
  "search_novel@2.0.0",
  "submit_result@3.0.0",
  "write_file@1.0.0",
]);

const catalog = new ToolGroupCatalog([
  loadToolGroupManifest(`
schemaVersion: 1
id: novel
version: 1.0.0
label: Novel tools
tools:
  - search_novel
  - submit_result
`),
  loadToolGroupManifest(`
schemaVersion: 1
id: files
version: 1.0.0
label: File tools
tools:
  - read_file
  - write_file
  - submit_result
`),
]);
const view = new ToolRegistryView({
  registry,
  groups: catalog,
  policy: {
    groupIds: ["files", "novel"],
    allow: ["read_file", "search_novel", "submit_result"],
    deny: ["submit_result"],
  },
});
assert.deepEqual(view.listAllowed().map(identity), [
  "read_file@1.1.0",
  "search_novel@2.0.0",
]);

const bridgeRequests = [];
const updates = [];
const adapter = new PiToolAdapter({
  async execute(request) {
    bridgeRequests.push(request);
    await request.progress.emit(
      captureToolExecutionUpdate({
        kind: "progress",
        completed: 1,
        total: 1,
      }),
    );
    return captureToolResult(
      {
        content: [{ type: "text", text: "ok" }],
        details: { toolVersion: request.tool.descriptor.version },
      },
      {
        conversationId: "conversation-1",
        toolCallId: request.toolCallId,
        toolName: request.tool.descriptor.name,
        toolVersion: request.tool.descriptor.version,
        limits: {
          maximumContentBlocks: 2,
          maximumTextBytes: 128,
          maximumDetailsBytes: 128,
          maximumArtifactReferences: 0,
        },
      },
    );
  },
});
const piTools = adapter.toAgentTools(view.listAllowed());
assert.deepEqual(piTools.map((toolValue) => toolValue.name), [
  "read_file",
  "search_novel",
]);
const result = await piTools[1].execute(
  "tool-call-1",
  { value: "chapter" },
  new AbortController().signal,
  (update) => updates.push(update),
);
assert.equal(bridgeRequests.length, 1);
assert.equal(bridgeRequests[0].tool.descriptor.name, "search_novel");
assert.equal(bridgeRequests[0].tool.descriptor.version, "2.0.0");
assert.deepEqual(bridgeRequests[0].arguments, { value: "chapter" });
assert.deepEqual(updates, [
  {
    content: [],
    details: { kind: "progress", completed: 1, total: 1 },
  },
]);
assert.deepEqual(result, {
  content: [{ type: "text", text: "ok" }],
  details: {
    kind: "result",
    details: { toolVersion: "2.0.0" },
  },
});

const brokenCatalog = new ToolGroupCatalog([
  loadToolGroupManifest(`
schemaVersion: 1
id: broken
version: 1.0.0
label: Broken
tools: [missing_tool]
`),
]);
assert.throws(
  () =>
    new ToolRegistryView({
      registry,
      groups: brokenCatalog,
      policy: { groupIds: ["broken"] },
    }),
  (error) =>
    error instanceof ToolRegistryViewError &&
    error.failure === TOOL_REGISTRY_VIEW_FAILURE.unknownTool &&
    error.groupId === "broken" &&
    error.toolName === "missing_tool",
);

const publicDeclaration = await readFile(
  join(process.cwd(), "dist", "index.d.ts"),
  "utf8",
);
assert.equal(publicDeclaration.includes("@earendil-works/pi-agent-core"), false);
assert.equal(publicDeclaration.includes("PiToolAdapter"), false);

console.log("Tool Registry Checkpoint 5A integration smoke passed");

function tool(name, version) {
  return defineTool({
    descriptor: {
      name,
      version,
      label: name,
      description: `${name} tool`,
      parameters: Type.Object({ value: Type.Optional(Type.String()) }),
    },
    handler,
  });
}

function identity(toolValue) {
  return `${toolValue.descriptor.name}@${toolValue.descriptor.version}`;
}
