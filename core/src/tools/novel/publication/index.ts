/** Novel Publication Tools group: Volumes and Chapters with Paragraph selections. */
import type { Logger } from "../../../observability/index.js";
import type { ToolGroupManifest } from "../../../tooling/group/index.js";
import { ToolRegistry } from "../../../tooling/registry/index.js";
import { createChapterEditTool, createVolumeEditTool } from "./Edit.js";
import { createChapterReadTool, createVolumeReadTool } from "./Read.js";
import { createChapterWriteTool, createVolumeWriteTool } from "./Write.js";
import type { NovelPublicationToolService } from "./ToolService.js";

export { createChapterEditTool as createNovelChapterEditTool } from "./Edit.js";
export { createChapterReadTool as createNovelChapterReadTool } from "./Read.js";
export { createVolumeReadTool as createNovelVolumeReadTool } from "./Read.js";
export { createChapterWriteTool as createNovelChapterWriteTool } from "./Write.js";
export { createVolumeWriteTool as createNovelVolumeWriteTool } from "./Write.js";
export { createVolumeEditTool as createNovelVolumeEditTool } from "./Edit.js";
export * from "./schemas.js";
export {
  NovelPublicationToolService,
  type NovelPublicationToolServiceOptions,
} from "./ToolService.js";

export const NOVEL_PUBLICATION_TOOL_GROUP_MANIFEST: ToolGroupManifest =
  Object.freeze({
    schemaVersion: 1,
    id: "novel.publication",
    version: "1.0.0",
    label: "Novel Publication",
    description:
      "Read, write, and edit Volumes and Chapters; Chapters own ordered Paragraph selections.",
    tools: Object.freeze([
      "NovelVolumeRead",
      "NovelVolumeWrite",
      "NovelVolumeEdit",
      "NovelChapterRead",
      "NovelChapterWrite",
      "NovelChapterEdit",
    ]),
  });

export interface CreateNovelPublicationToolRegistryOptions {
  readonly service: NovelPublicationToolService;
  readonly logger?: Logger;
}

export function createNovelPublicationToolRegistry(
  options: CreateNovelPublicationToolRegistryOptions,
): ToolRegistry {
  return new ToolRegistry([
    createVolumeReadTool(options),
    createVolumeWriteTool(options),
    createVolumeEditTool(options),
    createChapterReadTool(options),
    createChapterWriteTool(options),
    createChapterEditTool(options),
  ]);
}
