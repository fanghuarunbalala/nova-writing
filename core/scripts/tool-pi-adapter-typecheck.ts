/** Compile-only proof that Pi conversion preserves TypeBox parameters internally. */
import { Type } from "typebox";
import { defineTool } from "../src/tools/index.js";
import {
  PiToolAdapter,
  type PiToolExecutionBridge,
} from "../src/runtime/agent/pi/PiToolAdapter.js";

const bridge: PiToolExecutionBridge = {
  async execute() {
    return { content: [] };
  },
};
const registered = defineTool({
  descriptor: {
    name: "SearchNovel",
    version: "1.0.0",
    label: "Search novel",
    description: "Searches Novel content.",
    parameters: Type.Object({ query: Type.String() }),
  },
  handler: {
    async execute() {
      return { content: [] };
    },
  },
});
const tool = new PiToolAdapter(bridge).toAgentTool(registered);

void tool.execute("tool-call-1", { query: "hero" });
// @ts-expect-error Pi Tool argument inference must preserve the required query.
void tool.execute("tool-call-2", {});
// @ts-expect-error Pi Tool argument inference must not accept a numeric query.
void tool.execute("tool-call-3", { query: 1 });
