import assert from "node:assert/strict";
import {
  TOOL_GROUP_MANIFEST_FAILURE,
  TOOL_GROUP_MANIFEST_SCHEMA_VERSION,
  ToolGroupManifestError,
  captureToolGroupManifest,
  loadToolGroupManifest,
} from "../dist/index.js";

const manifest = loadToolGroupManifest(`
schemaVersion: 1
id: novel_read
version: 2.1.0
label: Novel read tools
description: Read-only access to Novel state.
tools:
  - search_novel
  - read_chapter
`);
assert.equal(Object.isFrozen(manifest), true);
assert.equal(Object.isFrozen(manifest.tools), true);
assert.equal(manifest.schemaVersion, TOOL_GROUP_MANIFEST_SCHEMA_VERSION);
assert.equal(manifest.id, "novel_read");
assert.equal(manifest.version, "2.1.0");
assert.equal(manifest.label, "Novel read tools");
assert.equal(manifest.description, "Read-only access to Novel state.");
assert.deepEqual(manifest.tools, ["search_novel", "read_chapter"]);

const minimal = loadToolGroupManifest(`
schemaVersion: 1
id: core
version: 1.0.0
label: Core tools
tools: [read_file]
`);
assert.equal("description" in minimal, false);

const sourceTools = ["first_tool", "second_tool"];
const captured = captureToolGroupManifest({
  schemaVersion: 1,
  id: "captured",
  version: "1.0.0",
  label: "Captured",
  tools: sourceTools,
});
sourceTools[0] = "mutated_tool";
assert.deepEqual(captured.tools, ["first_tool", "second_tool"]);

assertManifestFailure(
  `schemaVersion: 1\nid: group\nid: duplicate\nversion: 1.0.0\nlabel: Group\ntools: [read_file]\n`,
  TOOL_GROUP_MANIFEST_FAILURE.parseFailed,
);
assertManifestFailure(
  `schemaVersion: 1\nid: group\nversion: 1.0.0\nlabel: Group\ntools: &tools [read_file]\ncopy: *tools\n`,
  TOOL_GROUP_MANIFEST_FAILURE.parseFailed,
);
assertManifestFailure(
  `schemaVersion: 1\nid: group\nversion: 1.0.0\nlabel: Group\ntools: [read_file]\n---\nid: second\n`,
  TOOL_GROUP_MANIFEST_FAILURE.parseFailed,
);
assertManifestFailure(
  `schemaVersion: 2\nid: group\nversion: 1.0.0\nlabel: Group\ntools: [read_file]\n`,
  TOOL_GROUP_MANIFEST_FAILURE.unsupportedSchemaVersion,
);
assertManifestFailure(
  `schemaVersion: 1\nid: Invalid-Group\nversion: 1.0.0\nlabel: Group\ntools: [read_file]\n`,
  TOOL_GROUP_MANIFEST_FAILURE.invalidGroupId,
);
assertManifestFailure(
  `schemaVersion: 1\nid: group\nversion: v1\nlabel: Group\ntools: [read_file]\n`,
  TOOL_GROUP_MANIFEST_FAILURE.invalidGroupVersion,
);
assertManifestFailure(
  `schemaVersion: 1\nid: group\nversion: 1.0.0\nlabel: "  "\ntools: [read_file]\n`,
  TOOL_GROUP_MANIFEST_FAILURE.invalidMetadata,
);
assertManifestFailure(
  `schemaVersion: 1\nid: group\nversion: 1.0.0\nlabel: Group\ntools: []\n`,
  TOOL_GROUP_MANIFEST_FAILURE.invalidToolList,
);
assertManifestFailure(
  `schemaVersion: 1\nid: group\nversion: 1.0.0\nlabel: Group\ntools: [Invalid-Tool]\n`,
  TOOL_GROUP_MANIFEST_FAILURE.invalidToolName,
);
assertManifestFailure(
  `schemaVersion: 1\nid: group\nversion: 1.0.0\nlabel: Group\ntools: [read_file, read_file]\n`,
  TOOL_GROUP_MANIFEST_FAILURE.duplicateTool,
  "group",
  "1.0.0",
  "read_file",
);
assertManifestFailure(
  `schemaVersion: 1\nid: group\nversion: 1.0.0\nlabel: Group\ntools: [read_file]\nparameters: private\n`,
  TOOL_GROUP_MANIFEST_FAILURE.invalidStructure,
);

const privateYamlData = "DO_NOT_EXPOSE_PRIVATE_YAML_DATA";
assert.throws(
  () => loadToolGroupManifest(`private: [${privateYamlData}`),
  (error) => {
    assert.equal(error instanceof ToolGroupManifestError, true);
    const exposed = JSON.stringify({
      name: error.name,
      message: error.message,
      code: error.code,
      failure: error.failure,
      groupId: error.groupId,
      groupVersion: error.groupVersion,
      toolName: error.toolName,
    });
    return !exposed.includes(privateYamlData) && !String(error).includes(privateYamlData);
  },
);
const privateGetterData = "DO_NOT_EXPOSE_PRIVATE_GETTER_DATA";
const getterManifest = {
  schemaVersion: 1,
  id: "private_group",
  version: "1.0.0",
  label: "Private",
  tools: ["read_file"],
};
Object.defineProperty(getterManifest, "private", {
  enumerable: true,
  get() {
    throw new Error(privateGetterData);
  },
});
assert.throws(
  () => captureToolGroupManifest(getterManifest),
  (error) =>
    error instanceof ToolGroupManifestError &&
    error.failure === TOOL_GROUP_MANIFEST_FAILURE.invalidStructure &&
    !String(error).includes(privateGetterData),
);

console.log("tool group manifest smoke passed");

function assertManifestFailure(
  source,
  expectedFailure,
  expectedGroupId,
  expectedGroupVersion,
  expectedToolName,
) {
  assert.throws(
    () => loadToolGroupManifest(source),
    (error) =>
      error instanceof ToolGroupManifestError &&
      error.code === "TOOL_GROUP_MANIFEST_FAILED" &&
      error.failure === expectedFailure &&
      (expectedGroupId === undefined || error.groupId === expectedGroupId) &&
      (expectedGroupVersion === undefined ||
        error.groupVersion === expectedGroupVersion) &&
      (expectedToolName === undefined || error.toolName === expectedToolName),
  );
}
