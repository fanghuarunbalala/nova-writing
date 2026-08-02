/** Compile-only proof that defineTool preserves TypeBox argument inference. */
import { Type } from "typebox";
import { defineTool } from "../src/tools/index.js";

const parameters = Type.Object({
  query: Type.String(),
  limit: Type.Optional(Type.Integer({ minimum: 1 })),
});

const inferredTool = defineTool({
  descriptor: {
    name: "search_notes",
    version: "1.0.0",
    label: "Search notes",
    description: "Searches indexed notes.",
    parameters,
  },
  handler: {
    async execute(_context, arguments_) {
      const query: string = arguments_.query;
      const limit: number | undefined = arguments_.limit;
      // @ts-expect-error TypeBox inference must not widen an optional number to string.
      const invalidLimit: string = arguments_.limit;
      void invalidLimit;
      return {
        content: [{ type: "text", text: query }],
        details: { effectiveLimit: limit ?? 10 },
      };
    },
  },
});

void inferredTool;
