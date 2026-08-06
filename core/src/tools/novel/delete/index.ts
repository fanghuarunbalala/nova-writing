/** Novel Delete Tools group: unified deletion across Novel entities. */
import type { Logger } from "../../../observability/index.js";
import type { ToolGroupManifest } from "../../../tooling/group/index.js";
import { ToolRegistry } from "../../../tooling/registry/index.js";
import { createDeleteTool } from "./Delete.js";
import type { NovelDeleteToolService } from "./ToolService.js";

export { createDeleteTool as createNovelDeleteTool } from "./Delete.js";
export * from "./schemas.js";
export {
  NovelDeleteToolService,
  type NovelDeleteToolServiceOptions,
} from "./ToolService.js";

export const NOVEL_DELETE_TOOL_GROUP_MANIFEST: ToolGroupManifest =
  Object.freeze({
    schemaVersion: 1,
    id: "novel.delete",
    version: "1.0.0",
    label: "Novel Delete",
    description:
      "Unified deletion of story units, characters, locations, paragraphs, volumes, and chapters in a conversation Draft.",
    tools: Object.freeze(["NovelDelete"]),
  });

export interface CreateNovelDeleteToolRegistryOptions {
  readonly service: NovelDeleteToolService;
  readonly logger?: Logger;
}

export function createNovelDeleteToolRegistry(
  options: CreateNovelDeleteToolRegistryOptions,
): ToolRegistry {
  return new ToolRegistry([createDeleteTool(options)]);
}
