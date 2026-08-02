import assert from "node:assert/strict";
import { Type } from "typebox";
import {
  TOOL_GROUP_CATALOG_FAILURE,
  TOOL_REGISTRY_VIEW_FAILURE,
  ToolGroupCatalog,
  ToolGroupCatalogError,
  ToolRegistryAssembler,
  ToolRegistryView,
  ToolRegistryViewError,
  captureToolGroupManifest,
  defineTool,
} from "../dist/index.js";

const handler = Object.freeze({
  async execute() {
    return { content: [] };
  },
});
const tools = [
  tool("read_file"),
  tool("write_file"),
  tool("search_novel"),
  tool("submit_result"),
];
const registry = new ToolRegistryAssembler();
for (const registered of tools) registry.register(registered);
const frozenRegistry = registry.freeze();

const files = group("files", ["read_file", "write_file"]);
const novel = group("novel", ["search_novel", "read_file"]);
const submit = group("submit", ["submit_result"]);
const catalog = new ToolGroupCatalog([submit, novel, files]);
assert.equal(Object.isFrozen(catalog), true);
assert.equal(Object.isFrozen(catalog.list()), true);
assert.deepEqual(catalog.list().map((manifest) => manifest.id), [
  "files",
  "novel",
  "submit",
]);
assert.equal(catalog.require("novel").label, "novel tools");

const groupIds = ["files", "novel"];
const allow = ["read_file", "search_novel", "submit_result"];
const deny = ["read_file"];
const view = new ToolRegistryView({
  registry: frozenRegistry,
  groups: catalog,
  policy: { groupIds, allow, deny },
});
groupIds[0] = "submit";
allow[0] = "write_file";
deny.length = 0;
assert.equal(Object.isFrozen(view), true);
assert.equal(Object.isFrozen(view.policy), true);
assert.equal(Object.isFrozen(view.policy.groupIds), true);
assert.equal(Object.isFrozen(view.listAllowed()), true);
assert.deepEqual(view.policy.groupIds, ["files", "novel"]);
assert.deepEqual(view.listAllowed().map((registered) => registered.descriptor.name), [
  "search_novel",
]);
assert.equal(view.has("search_novel"), true);
assert.equal(view.has("read_file"), false);
assert.equal(view.get("write_file"), undefined);
assert.equal(view.require("search_novel").descriptor.name, "search_novel");

const orderedView = new ToolRegistryView({
  registry: frozenRegistry,
  groups: catalog,
  policy: { groupIds: ["files", "novel", "submit"] },
});
assert.deepEqual(
  orderedView.listAllowed().map((registered) => registered.descriptor.name),
  ["read_file", "write_file", "search_novel", "submit_result"],
);

const emptyView = new ToolRegistryView({
  registry: frozenRegistry,
  groups: catalog,
  policy: { groupIds: [], allow: ["read_file"] },
});
assert.equal(emptyView.size, 0);

assertCatalogFailure(
  () => new ToolGroupCatalog([files, group("files", ["submit_result"])]),
  TOOL_GROUP_CATALOG_FAILURE.duplicateGroup,
  "files",
);
assertCatalogFailure(
  () => catalog.require("missing_group"),
  TOOL_GROUP_CATALOG_FAILURE.unknownGroup,
  "missing_group",
);
assertViewFailure(
  () => createView({ groupIds: ["missing_group"] }),
  undefined,
  undefined,
  ToolGroupCatalogError,
);
assertViewFailure(
  () => createView({ groupIds: ["files", "files"] }),
  TOOL_REGISTRY_VIEW_FAILURE.duplicateGroupSelection,
  "files",
);
assertViewFailure(
  () => createView({ groupIds: ["files"], allow: ["read_file", "read_file"] }),
  TOOL_REGISTRY_VIEW_FAILURE.duplicateAllowTool,
  undefined,
  ToolRegistryViewError,
  "read_file",
);
assertViewFailure(
  () => createView({ groupIds: ["files"], deny: ["read_file", "read_file"] }),
  TOOL_REGISTRY_VIEW_FAILURE.duplicateDenyTool,
  undefined,
  ToolRegistryViewError,
  "read_file",
);
assertViewFailure(
  () => createView({ groupIds: ["files"], allow: ["missing_tool"] }),
  TOOL_REGISTRY_VIEW_FAILURE.unknownTool,
  undefined,
  ToolRegistryViewError,
  "missing_tool",
);
assertViewFailure(
  () => createView({ groupIds: ["files"], deny: ["missing_tool"] }),
  TOOL_REGISTRY_VIEW_FAILURE.unknownTool,
  undefined,
  ToolRegistryViewError,
  "missing_tool",
);
assertViewFailure(
  () =>
    new ToolRegistryView({
      registry: frozenRegistry,
      groups: new ToolGroupCatalog([group("broken", ["missing_tool"])]),
      policy: { groupIds: ["broken"] },
    }),
  TOOL_REGISTRY_VIEW_FAILURE.unknownTool,
  "broken",
  ToolRegistryViewError,
  "missing_tool",
);
assertViewFailure(
  () => orderedView.require("write_secret"),
  TOOL_REGISTRY_VIEW_FAILURE.unknownTool,
  undefined,
  ToolRegistryViewError,
  "write_secret",
);
assertViewFailure(
  () =>
    createView({
      groupIds: ["files"],
      extra: "DO_NOT_EXPOSE_PRIVATE_POLICY_DATA",
    }),
  TOOL_REGISTRY_VIEW_FAILURE.invalidPolicy,
);

console.log("tool registry view smoke passed");

function tool(name) {
  return defineTool({
    descriptor: {
      name,
      version: "1.0.0",
      label: name,
      description: `${name} tool`,
      parameters: Type.Object({}),
    },
    handler,
  });
}

function group(id, toolNames) {
  return captureToolGroupManifest({
    schemaVersion: 1,
    id,
    version: "1.0.0",
    label: `${id} tools`,
    tools: toolNames,
  });
}

function createView(policy) {
  return new ToolRegistryView({
    registry: frozenRegistry,
    groups: catalog,
    policy,
  });
}

function assertCatalogFailure(invoke, expectedFailure, expectedGroupId) {
  assert.throws(
    invoke,
    (error) =>
      error instanceof ToolGroupCatalogError &&
      error.code === "TOOL_GROUP_CATALOG_FAILED" &&
      error.failure === expectedFailure &&
      error.groupId === expectedGroupId,
  );
}

function assertViewFailure(
  invoke,
  expectedFailure,
  expectedGroupId,
  errorType = ToolRegistryViewError,
  expectedToolName,
) {
  assert.throws(
    invoke,
    (error) =>
      error instanceof errorType &&
      (expectedFailure === undefined || error.failure === expectedFailure) &&
      (expectedGroupId === undefined || error.groupId === expectedGroupId) &&
      (expectedToolName === undefined || error.toolName === expectedToolName),
  );
}
