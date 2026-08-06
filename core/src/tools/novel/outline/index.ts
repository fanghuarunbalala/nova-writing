/** Novel Outline Tool group: read, write, and edit the story outline. */
import type { Logger } from "../../../observability/index.js";
import type { ToolGroupManifest } from "../../../tooling/group/index.js";
import { ToolRegistry } from "../../../tooling/registry/index.js";
import { createEditTool } from "./Edit.js";
import { createReadTool } from "./Read.js";
import { createWriteTool } from "./Write.js";
import type {
  OutlineToolService,
  OutlineToolServiceOptions,
} from "./ToolService.js";

export { createEditTool as createNovelOutlineEditTool } from "./Edit.js";
export { createReadTool as createNovelOutlineReadTool } from "./Read.js";
export { createWriteTool as createNovelOutlineWriteTool } from "./Write.js";
export * from "./schemas.js";
export {
  OutlineToolService,
  type OutlineToolServiceOptions,
} from "./ToolService.js";

export const NOVEL_OUTLINE_TOOL_GROUP_MANIFEST: ToolGroupManifest =
  Object.freeze({
    schemaVersion: 1,
    id: "novel.outline",
    version: "1.0.0",
    label: "Novel Outline",
    description:
      "Read, write, and edit the story outline in a conversation Draft.",
    tools: Object.freeze([
      "NovelOutlineRead",
      "NovelOutlineWrite",
      "NovelOutlineEdit",
    ]),
  });

export interface CreateNovelOutlineToolRegistryOptions {
  readonly service: OutlineToolService;
  readonly logger?: Logger;
}

export function createNovelOutlineToolRegistry(
  options: CreateNovelOutlineToolRegistryOptions,
): ToolRegistry {
  return new ToolRegistry([
    createReadTool(options),
    createWriteTool(options),
    createEditTool(options),
  ]);
}
