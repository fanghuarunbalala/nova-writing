/** Compile-only proof that Registry snapshots expose immutable, Provider-neutral Tools. */
import { Type } from "typebox";
import { ToolRegistryAssembler, defineTool } from "../src/tools/index.js";

const registered = defineTool({
  descriptor: {
    name: "search_notes",
    version: "1.0.0",
    label: "Search notes",
    description: "Searches indexed notes.",
    parameters: Type.Object({ query: Type.String() }),
  },
  handler: {
    async execute(_context, arguments_) {
      return { content: [{ type: "text", text: arguments_.query }] };
    },
  },
});

const assembler = new ToolRegistryAssembler().register(registered);
const registry = assembler.freeze();
const listed = registry.list();

// @ts-expect-error Frozen Registry lists must not allow mutation.
listed.push(registered);
// @ts-expect-error Immutable Registries do not expose registration methods.
registry.register(registered);

void registry.require("search_notes");
