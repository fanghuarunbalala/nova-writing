import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { Type } from "typebox";
import {
  ARTIFACT_REFERENCE_SCHEMA_VERSION,
  TOOL_PROTOCOL_FAILURE,
  ToolProtocolError,
  captureRegisteredTool,
  captureToolDescriptor,
  captureToolExecutionUpdate,
  captureToolResult,
  defineTool,
  noopToolProgressSink,
} from "../dist/index.js";

const limits = Object.freeze({
  maximumContentBlocks: 4,
  maximumTextBytes: 64,
  maximumDetailsBytes: 64,
  maximumArtifactReferences: 2,
});
const captureOptions = Object.freeze({
  conversationId: "conversation-1",
  toolCallId: "tool-call-1",
  toolName: "search_notes",
  toolVersion: "1.0.0",
  limits,
});

const parameterSource = Type.Object(
  {
    query: Type.String({ minLength: 1 }),
    limit: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { additionalProperties: false },
);
const descriptorSource = {
  name: "search_notes",
  version: "1.0.0",
  label: "Search notes",
  description: "Searches indexed notes.",
  parameters: parameterSource,
};
const descriptor = captureToolDescriptor(descriptorSource);
assert.equal(Object.isFrozen(descriptor), true);
assert.equal(Object.isFrozen(descriptor.parameters), true);
assert.equal(Object.isFrozen(descriptor.parameters.properties), true);
assert.equal(descriptor.parameters["~kind"], "Object");
descriptorSource.label = "mutated";
parameterSource.properties.query.minLength = 99;
assert.equal(descriptor.label, "Search notes");
assert.equal(descriptor.parameters.properties.query.minLength, 1);

for (const name of ["Search", "1search", "search-notes", `a${"b".repeat(64)}`]) {
  assertProtocolFailure(
    () => captureToolDescriptor({ ...descriptorSource, name }),
    TOOL_PROTOCOL_FAILURE.invalidName,
  );
}
for (const version of ["1", "1.0", "01.0.0", "1.0.0-beta", "v1.0.0"]) {
  assertProtocolFailure(
    () => captureToolDescriptor({ ...descriptorSource, version }),
    TOOL_PROTOCOL_FAILURE.invalidVersion,
  );
}
assertProtocolFailure(
  () =>
    captureToolDescriptor({
      ...descriptorSource,
      parameters: { type: "object", properties: {} },
    }),
  TOOL_PROTOCOL_FAILURE.invalidSchema,
);
assertProtocolFailure(
  () =>
    captureToolDescriptor({
      ...descriptorSource,
      parameters: { "~kind": "Object" },
    }),
  TOOL_PROTOCOL_FAILURE.invalidSchema,
);
assertProtocolFailure(
  () =>
    captureToolDescriptor({
      ...descriptorSource,
      parameters: { ...parameterSource, invalid: () => "private" },
    }),
  TOOL_PROTOCOL_FAILURE.invalidSchema,
);

let originalHandlerCalls = 0;
const registrationSource = {
  descriptor: descriptorSource,
  handler: {
    async execute(_context, arguments_, progress) {
      originalHandlerCalls += 1;
      await progress.emit({ kind: "progress", completed: 1, total: 1 });
      return { content: [{ type: "text", text: arguments_.query }] };
    },
  },
};
const registered = defineTool(registrationSource);
assert.equal(Object.isFrozen(registered), true);
assert.equal(Object.isFrozen(registered.handler), true);
registrationSource.handler.execute = async () => ({ content: [] });
const executionResult = await registered.handler.execute(
  {
    conversationId: "conversation-1",
    runId: "run-1",
    toolCallId: "tool-call-1",
    signal: new AbortController().signal,
  },
  { query: "chapter" },
  noopToolProgressSink,
);
assert.equal(originalHandlerCalls, 1);
assert.equal(executionResult.content[0].text, "chapter");
assertProtocolFailure(
  () => captureRegisteredTool({ descriptor: descriptorSource, handler: {} }),
  TOOL_PROTOCOL_FAILURE.invalidHandler,
);

const resultSource = {
  content: [{ type: "text", text: "found" }],
  details: { count: 1, nested: { cached: false } },
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
};
const result = captureToolResult(resultSource, captureOptions);
assert.equal(Object.isFrozen(result), true);
assert.equal(Object.isFrozen(result.content), true);
assert.equal(Object.isFrozen(result.content[0]), true);
assert.equal(Object.isFrozen(result.details), true);
assert.equal(Object.isFrozen(result.details.nested), true);
assert.equal(Object.isFrozen(result.artifacts), true);
resultSource.content[0].text = "mutated";
resultSource.details.nested.cached = true;
assert.equal(result.content[0].text, "found");
assert.equal(result.details.nested.cached, false);

assertProtocolFailure(
  () =>
    captureToolResult(
      { content: [], details: { invalid: undefined } },
      captureOptions,
    ),
  TOOL_PROTOCOL_FAILURE.invalidDetails,
);
const cyclicDetails = {};
cyclicDetails.self = cyclicDetails;
assertProtocolFailure(
  () => captureToolResult({ content: [], details: cyclicDetails }, captureOptions),
  TOOL_PROTOCOL_FAILURE.invalidDetails,
);
assertProtocolFailure(
  () =>
    captureToolResult(
      { content: [{ type: "text", text: "汉字" }] },
      { ...captureOptions, limits: { ...limits, maximumTextBytes: 5 } },
    ),
  TOOL_PROTOCOL_FAILURE.resultOversized,
);
assertProtocolFailure(
  () =>
    captureToolResult(
      { content: [], details: { private: "oversized" } },
      { ...captureOptions, limits: { ...limits, maximumDetailsBytes: 4 } },
    ),
  TOOL_PROTOCOL_FAILURE.resultOversized,
);
assertProtocolFailure(
  () =>
    captureToolResult(
      {
        ...resultSource,
        artifacts: [
          { ...resultSource.artifacts[0], conversationId: "conversation-2" },
        ],
      },
      captureOptions,
    ),
  TOOL_PROTOCOL_FAILURE.artifactConversationMismatch,
);

const progress = captureToolExecutionUpdate({
  kind: "progress",
  message: "private incremental text",
  completed: 1,
  total: 2,
});
assert.equal(Object.isFrozen(progress), true);
const partial = captureToolExecutionUpdate({
  kind: "partial_result",
  content: [{ type: "text", text: "private partial result" }],
});
assert.equal(Object.isFrozen(partial), true);
assert.equal(Object.isFrozen(partial.content), true);
assertProtocolFailure(
  () => captureToolExecutionUpdate({ kind: "progress", completed: 3, total: 2 }),
  TOOL_PROTOCOL_FAILURE.invalidProgress,
);
assertProtocolFailure(
  () => captureToolExecutionUpdate({ kind: "progress", completed: -1 }),
  TOOL_PROTOCOL_FAILURE.invalidProgress,
);

const privateToolData = "DO_NOT_EXPOSE_PRIVATE_TOOL_DATA";
for (const invoke of [
  () =>
    captureToolExecutionUpdate({
      kind: "progress",
      completed: privateToolData,
    }),
  () =>
    captureToolResult(
      { content: [{ type: "binary", text: privateToolData }] },
      captureOptions,
    ),
  () =>
    captureToolResult(
      { content: [], details: { value: BigInt(1), privateToolData } },
      captureOptions,
    ),
]) {
  assert.throws(invoke, (error) => {
    assert.equal(error instanceof ToolProtocolError, true);
    const exposed = JSON.stringify({
      message: error.message,
      name: error.name,
      code: error.code,
      failure: error.failure,
      toolName: error.toolName,
      toolVersion: error.toolVersion,
      conversationId: error.conversationId,
      toolCallId: error.toolCallId,
    });
    return !exposed.includes(privateToolData) && !String(error).includes(privateToolData);
  });
}

const declarations = await readDeclarations(
  join(process.cwd(), "dist", "tools", "protocol"),
);
assert.equal(declarations.includes("@earendil-works/pi-agent-core"), false);

console.log("tool protocol smoke passed");

function assertProtocolFailure(invoke, expectedFailure) {
  assert.throws(
    invoke,
    (error) =>
      error instanceof ToolProtocolError &&
      error.failure === expectedFailure &&
      error.message === "Tool protocol validation failed" &&
      error.stack?.includes("DO_NOT_EXPOSE_PRIVATE_TOOL_DATA") !== true &&
      !Object.hasOwn(error, "cause"),
  );
}

async function readDeclarations(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const chunks = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return readDeclarations(path);
      return entry.name.endsWith(".d.ts") ? readFile(path, "utf8") : "";
    }),
  );
  return chunks.join("\n");
}
