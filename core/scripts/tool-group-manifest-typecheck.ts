/** Compile-only proof that Tool Group metadata and ordered names are immutable. */
import {
  TOOL_GROUP_MANIFEST_SCHEMA_VERSION,
  captureToolGroupManifest,
} from "../src/tools/index.js";

const manifest = captureToolGroupManifest({
  schemaVersion: TOOL_GROUP_MANIFEST_SCHEMA_VERSION,
  id: "novel_read",
  version: "1.0.0",
  label: "Novel read",
  tools: ["SearchNovel", "ReadChapter"],
});

const schemaVersion: 1 = manifest.schemaVersion;
const firstTool: string | undefined = manifest.tools[0];

// @ts-expect-error Captured Tool name order must not be mutable.
manifest.tools.push("WriteChapter");
// @ts-expect-error Captured manifest metadata must not be mutable.
manifest.label = "Changed";

void schemaVersion;
void firstTool;
