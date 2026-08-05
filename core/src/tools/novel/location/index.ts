/** Novel Location Tools group: read, write, and edit Location profiles. */
import type { Logger } from "../../../observability/index.js";
import type { ToolGroupManifest } from "../../../tooling/group/index.js";
import { ToolRegistry } from "../../../tooling/registry/index.js";
import { createLocationEditTool } from "./Edit.js";
import { createLocationReadTool } from "./Read.js";
import { createLocationWriteTool } from "./Write.js";
import type { NovelLocationToolService } from "./ToolService.js";

export { createLocationEditTool as createNovelLocationEditTool } from "./Edit.js";
export { createLocationReadTool as createNovelLocationReadTool } from "./Read.js";
export { createLocationWriteTool as createNovelLocationWriteTool } from "./Write.js";
export * from "./schemas.js";
export {
  NovelLocationToolService,
  type NovelLocationToolServiceOptions,
} from "./ToolService.js";

export const NOVEL_LOCATION_TOOL_GROUP_MANIFEST: ToolGroupManifest =
  Object.freeze({
    schemaVersion: 1,
    id: "novel.locations",
    version: "1.0.0",
    label: "Novel Locations",
    description:
      "Read, write, and edit Location profiles in a conversation Draft.",
    tools: Object.freeze([
      "NovelLocationRead",
      "NovelLocationWrite",
      "NovelLocationEdit",
    ]),
  });

export interface CreateNovelLocationToolRegistryOptions {
  readonly service: NovelLocationToolService;
  readonly logger?: Logger;
}

export function createNovelLocationToolRegistry(
  options: CreateNovelLocationToolRegistryOptions,
): ToolRegistry {
  return new ToolRegistry([
    createLocationReadTool(options),
    createLocationWriteTool(options),
    createLocationEditTool(options),
  ]);
}
