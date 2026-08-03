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
  tool("ReadFile"),
  tool("WriteFile"),
  tool("SearchNovel"),
  tool("SubmitResult"),
];
const registry = new ToolRegistryAssembler();
for (const registered of tools) registry.register(registered);
const frozenRegistry = registry.freeze();

const files = group("files", ["ReadFile", "WriteFile"]);
const novel = group("novel", ["SearchNovel", "ReadFile"]);
const submit = group("submit", ["SubmitResult"]);
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
const allow = ["ReadFile", "SearchNovel", "SubmitResult"];
const deny = ["ReadFile"];
const view = new ToolRegistryView({
  registry: frozenRegistry,
  groups: catalog,
  policy: { groupIds, allow, deny },
});
groupIds[0] = "submit";
allow[0] = "WriteFile";
deny.length = 0;
assert.equal(Object.isFrozen(view), true);
assert.equal(Object.isFrozen(view.policy), true);
assert.equal(Object.isFrozen(view.policy.groupIds), true);
assert.equal(Object.isFrozen(view.listAllowed()), true);
assert.deepEqual(view.policy.groupIds, ["files", "novel"]);
assert.deepEqual(view.listAllowed().map((registered) => registered.descriptor.name), [
  "SearchNovel",
]);
assert.equal(view.has("SearchNovel"), true);
assert.equal(view.has("ReadFile"), false);
assert.equal(view.get("WriteFile"), undefined);
assert.equal(view.require("SearchNovel").descriptor.name, "SearchNovel");

const orderedView = new ToolRegistryView({
  registry: frozenRegistry,
  groups: catalog,
  policy: { groupIds: ["files", "novel", "submit"] },
});
assert.deepEqual(
  orderedView.listAllowed().map((registered) => registered.descriptor.name),
  ["ReadFile", "WriteFile", "SearchNovel", "SubmitResult"],
);

const emptyView = new ToolRegistryView({
  registry: frozenRegistry,
  groups: catalog,
  policy: { groupIds: [], allow: ["ReadFile"] },
});
assert.equal(emptyView.size, 0);

assertCatalogFailure(
  () => new ToolGroupCatalog([files, group("files", ["SubmitResult"])]),
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
  () => createView({ groupIds: ["files"], allow: ["ReadFile", "ReadFile"] }),
  TOOL_REGISTRY_VIEW_FAILURE.duplicateAllowTool,
  undefined,
  ToolRegistryViewError,
  "ReadFile",
);
assertViewFailure(
  () => createView({ groupIds: ["files"], deny: ["ReadFile", "ReadFile"] }),
  TOOL_REGISTRY_VIEW_FAILURE.duplicateDenyTool,
  undefined,
  ToolRegistryViewError,
  "ReadFile",
);
assertViewFailure(
  () => createView({ groupIds: ["files"], allow: ["MissingTool"] }),
  TOOL_REGISTRY_VIEW_FAILURE.unknownTool,
  undefined,
  ToolRegistryViewError,
  "MissingTool",
);
assertViewFailure(
  () => createView({ groupIds: ["files"], deny: ["MissingTool"] }),
  TOOL_REGISTRY_VIEW_FAILURE.unknownTool,
  undefined,
  ToolRegistryViewError,
  "MissingTool",
);
assertViewFailure(
  () =>
    new ToolRegistryView({
      registry: frozenRegistry,
      groups: new ToolGroupCatalog([group("broken", ["MissingTool"])]),
      policy: { groupIds: ["broken"] },
    }),
  TOOL_REGISTRY_VIEW_FAILURE.unknownTool,
  "broken",
  ToolRegistryViewError,
  "MissingTool",
);
assertViewFailure(
  () => orderedView.require("WriteSecret"),
  TOOL_REGISTRY_VIEW_FAILURE.unknownTool,
  undefined,
  ToolRegistryViewError,
  "WriteSecret",
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
