import assert from "node:assert/strict";
import { Type } from "typebox";
import {
  TOOL_REGISTRY_FAILURE,
  ToolRegistry,
  ToolRegistryAssembler,
  ToolRegistryError,
  defineTool,
} from "../dist/index.js";

const handler = Object.freeze({
  async execute() {
    return { content: [] };
  },
});

function tool(name, version = "1.0.0") {
  return defineTool({
    descriptor: {
      name,
      version,
      label: name,
      description: `Tool ${name}`,
      parameters: Type.Object({}),
    },
    handler,
  });
}

const assembler = new ToolRegistryAssembler();
const zetaSource = tool("ZetaTool");
const alphaSource = tool("AlphaTool", "2.0.0");
assembler.register(zetaSource).register(alphaSource);
assert.equal(assembler.size, 2);

const registry = assembler.freeze();
assert.equal(Object.isFrozen(registry), true);
assert.equal(registry.size, 2);
assert.equal(registry.has("AlphaTool"), true);
assert.equal(registry.has("MissingTool"), false);
assert.equal(registry.get("ZetaTool")?.descriptor.version, "1.0.0");
assert.equal(registry.require("AlphaTool").descriptor.version, "2.0.0");
assert.deepEqual(
  registry.list().map((registered) => registered.descriptor.name),
  ["AlphaTool", "ZetaTool"],
);
assert.equal(Object.isFrozen(registry.list()), true);
assert.equal(assembler.freeze(), registry);

assertRegistryFailure(
  () => assembler.register(tool("LaterTool")),
  TOOL_REGISTRY_FAILURE.assemblyFrozen,
);
assertRegistryFailure(
  () => assembler.merge(new ToolRegistry([tool("LaterTool")])),
  TOOL_REGISTRY_FAILURE.assemblyFrozen,
);
assertRegistryFailure(
  () => registry.require("MissingTool"),
  TOOL_REGISTRY_FAILURE.unknownTool,
);

const duplicateAssembler = new ToolRegistryAssembler();
duplicateAssembler.register(tool("SameTool", "1.0.0"));
assertRegistryFailure(
  () => duplicateAssembler.register(tool("SameTool", "1.0.0")),
  TOOL_REGISTRY_FAILURE.duplicateTool,
  "SameTool",
  "1.0.0",
);
assertRegistryFailure(
  () => duplicateAssembler.register(tool("SameTool", "2.0.0")),
  TOOL_REGISTRY_FAILURE.duplicateTool,
  "SameTool",
  "2.0.0",
);

const mergeAssembler = new ToolRegistryAssembler();
mergeAssembler.register(tool("ExistingTool"));
const conflictingRegistry = new ToolRegistry([
  tool("NewTool"),
  tool("ExistingTool", "3.0.0"),
]);
assertRegistryFailure(
  () => mergeAssembler.merge(conflictingRegistry),
  TOOL_REGISTRY_FAILURE.duplicateTool,
  "ExistingTool",
  "3.0.0",
);
assert.equal(mergeAssembler.size, 1);
assert.equal(mergeAssembler.freeze().has("NewTool"), false);

const mergedAssembler = new ToolRegistryAssembler();
mergedAssembler.register(tool("LocalTool"));
mergedAssembler.merge(new ToolRegistry([tool("RemoteB"), tool("RemoteA")]));
assert.deepEqual(
  mergedAssembler.freeze().list().map((registered) => registered.descriptor.name),
  ["LocalTool", "RemoteA", "RemoteB"],
);

const mutableDescriptor = {
  name: "CapturedTool",
  version: "1.0.0",
  label: "Captured",
  description: "Captured during Registry construction.",
  parameters: Type.Object({ value: Type.String() }),
};
const capturedRegistry = new ToolRegistry([
  { descriptor: mutableDescriptor, handler },
]);
mutableDescriptor.label = "Mutated";
assert.equal(capturedRegistry.require("CapturedTool").descriptor.label, "Captured");

const privateToolData = "DO_NOT_EXPOSE_PRIVATE_TOOL_DATA";
assert.throws(
  () =>
    new ToolRegistryAssembler()
      .register(tool("PrivateTool"))
      .register(
        defineTool({
          descriptor: {
            name: "PrivateTool",
            version: "2.0.0",
            label: privateToolData,
            description: privateToolData,
            parameters: Type.Object({}),
          },
          handler,
        }),
      ),
  (error) => {
    assert.equal(error instanceof ToolRegistryError, true);
    const exposed = JSON.stringify({
      name: error.name,
      message: error.message,
      code: error.code,
      failure: error.failure,
      toolName: error.toolName,
      toolVersion: error.toolVersion,
    });
    return !exposed.includes(privateToolData) && !String(error).includes(privateToolData);
  },
);
assert.throws(
  () => capturedRegistry.require(privateToolData),
  (error) =>
    error instanceof ToolRegistryError &&
    error.failure === TOOL_REGISTRY_FAILURE.unknownTool &&
    error.toolName === undefined &&
    !String(error).includes(privateToolData),
);

console.log("tool registry smoke passed");

function assertRegistryFailure(
  invoke,
  expectedFailure,
  expectedName,
  expectedVersion,
) {
  assert.throws(
    invoke,
    (error) =>
      error instanceof ToolRegistryError &&
      error.code === "TOOL_REGISTRY_FAILED" &&
      error.failure === expectedFailure &&
      (expectedName === undefined || error.toolName === expectedName) &&
      (expectedVersion === undefined || error.toolVersion === expectedVersion),
  );
}
