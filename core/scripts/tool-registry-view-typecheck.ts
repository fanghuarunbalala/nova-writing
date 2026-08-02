/** Compile-only proof that Registry Views expose read-only capability slices. */
import { Type } from "typebox";
import {
  ToolGroupCatalog,
  ToolRegistryAssembler,
  ToolRegistryView,
  captureToolGroupManifest,
  defineTool,
} from "../src/tools/index.js";

const registered = defineTool({
  descriptor: {
    name: "read_file",
    version: "1.0.0",
    label: "Read file",
    description: "Reads one file.",
    parameters: Type.Object({ path: Type.String() }),
  },
  handler: {
    async execute() {
      return { content: [] };
    },
  },
});
const registry = new ToolRegistryAssembler().register(registered).freeze();
const groups = new ToolGroupCatalog([
  captureToolGroupManifest({
    schemaVersion: 1,
    id: "files",
    version: "1.0.0",
    label: "Files",
    tools: ["read_file"],
  }),
]);
const view = new ToolRegistryView({
  registry,
  groups,
  policy: { groupIds: ["files"] },
});
const allowed = view.listAllowed();

// @ts-expect-error View Tool lists must not allow mutation.
allowed.push(registered);
// @ts-expect-error Registry Views do not expose Tool registration.
view.register(registered);
// @ts-expect-error Captured View policy is immutable.
view.policy.groupIds.push("other");

void view.require("read_file");
