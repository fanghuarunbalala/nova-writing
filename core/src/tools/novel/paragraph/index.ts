/** Novel Paragraph Tools group: read, write, and edit body Paragraphs. */
import type { Logger } from "../../../observability/index.js";
import type { ToolGroupManifest } from "../../../tooling/group/index.js";
import { ToolRegistry } from "../../../tooling/registry/index.js";
import { createParagraphEditTool } from "./Edit.js";
import { createParagraphReadTool } from "./Read.js";
import { createParagraphWriteTool } from "./Write.js";
import type { NovelParagraphToolService } from "./ToolService.js";

export { createParagraphEditTool as createNovelParagraphEditTool } from "./Edit.js";
export { createParagraphReadTool as createNovelParagraphReadTool } from "./Read.js";
export { createParagraphWriteTool as createNovelParagraphWriteTool } from "./Write.js";
export * from "./schemas.js";
export {
  NovelParagraphToolService,
  type NovelParagraphToolServiceOptions,
} from "./ToolService.js";

export const NOVEL_PARAGRAPH_TOOL_GROUP_MANIFEST: ToolGroupManifest =
  Object.freeze({
    schemaVersion: 1,
    id: "novel.paragraph",
    version: "1.0.0",
    label: "Novel Paragraphs",
    description:
      "Read, write, and edit body Paragraphs owned by StoryUnits in a conversation Draft.",
    tools: Object.freeze([
      "NovelParagraphRead",
      "NovelParagraphWrite",
      "NovelParagraphEdit",
    ]),
  });

export interface CreateNovelParagraphToolRegistryOptions {
  readonly service: NovelParagraphToolService;
  readonly logger?: Logger;
}

export function createNovelParagraphToolRegistry(
  options: CreateNovelParagraphToolRegistryOptions,
): ToolRegistry {
  return new ToolRegistry([
    createParagraphReadTool(options),
    createParagraphWriteTool(options),
    createParagraphEditTool(options),
  ]);
}
