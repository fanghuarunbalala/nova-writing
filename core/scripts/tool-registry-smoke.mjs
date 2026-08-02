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
const zetaSource = tool("zeta_tool");
const alphaSource = tool("alpha_tool", "2.0.0");
assembler.register(zetaSource).register(alphaSource);
assert.equal(assembler.size, 2);

const registry = assembler.freeze();
assert.equal(Object.isFrozen(registry), true);
assert.equal(registry.size, 2);
assert.equal(registry.has("alpha_tool"), true);
assert.equal(registry.has("missing_tool"), false);
assert.equal(registry.get("zeta_tool")?.descriptor.version, "1.0.0");
assert.equal(registry.require("alpha_tool").descriptor.version, "2.0.0");
assert.deepEqual(
  registry.list().map((registered) => registered.descriptor.name),
  ["alpha_tool", "zeta_tool"],
);
assert.equal(Object.isFrozen(registry.list()), true);
assert.equal(assembler.freeze(), registry);

assertRegistryFailure(
  () => assembler.register(tool("later_tool")),
  TOOL_REGISTRY_FAILURE.assemblyFrozen,
);
assertRegistryFailure(
  () => assembler.merge(new ToolRegistry([tool("later_tool")])),
  TOOL_REGISTRY_FAILURE.assemblyFrozen,
);
assertRegistryFailure(
  () => registry.require("missing_tool"),
  TOOL_REGISTRY_FAILURE.unknownTool,
);

const duplicateAssembler = new ToolRegistryAssembler();
duplicateAssembler.register(tool("same_tool", "1.0.0"));
assertRegistryFailure(
  () => duplicateAssembler.register(tool("same_tool", "1.0.0")),
  TOOL_REGISTRY_FAILURE.duplicateTool,
  "same_tool",
  "1.0.0",
);
assertRegistryFailure(
  () => duplicateAssembler.register(tool("same_tool", "2.0.0")),
  TOOL_REGISTRY_FAILURE.duplicateTool,
  "same_tool",
  "2.0.0",
);

const mergeAssembler = new ToolRegistryAssembler();
mergeAssembler.register(tool("existing_tool"));
const conflictingRegistry = new ToolRegistry([
  tool("new_tool"),
  tool("existing_tool", "3.0.0"),
]);
assertRegistryFailure(
  () => mergeAssembler.merge(conflictingRegistry),
  TOOL_REGISTRY_FAILURE.duplicateTool,
  "existing_tool",
  "3.0.0",
);
assert.equal(mergeAssembler.size, 1);
assert.equal(mergeAssembler.freeze().has("new_tool"), false);

const mergedAssembler = new ToolRegistryAssembler();
mergedAssembler.register(tool("local_tool"));
mergedAssembler.merge(new ToolRegistry([tool("remote_b"), tool("remote_a")]));
assert.deepEqual(
  mergedAssembler.freeze().list().map((registered) => registered.descriptor.name),
  ["local_tool", "remote_a", "remote_b"],
);

const mutableDescriptor = {
  name: "captured_tool",
  version: "1.0.0",
  label: "Captured",
  description: "Captured during Registry construction.",
  parameters: Type.Object({ value: Type.String() }),
};
const capturedRegistry = new ToolRegistry([
  { descriptor: mutableDescriptor, handler },
]);
mutableDescriptor.label = "Mutated";
assert.equal(capturedRegistry.require("captured_tool").descriptor.label, "Captured");

const privateToolData = "DO_NOT_EXPOSE_PRIVATE_TOOL_DATA";
assert.throws(
  () =>
    new ToolRegistryAssembler()
      .register(tool("private_tool"))
      .register(
        defineTool({
          descriptor: {
            name: "private_tool",
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
