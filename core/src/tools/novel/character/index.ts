/** Novel Character Tools group: read, write, and edit Character profiles. */
import type { Logger } from "../../../observability/index.js";
import type { ToolGroupManifest } from "../../../tooling/group/index.js";
import { ToolRegistry } from "../../../tooling/registry/index.js";
import { createCharacterEditTool } from "./Edit.js";
import { createCharacterReadTool } from "./Read.js";
import { createCharacterWriteTool } from "./Write.js";
import type { NovelCharacterToolService } from "./ToolService.js";

export { createCharacterEditTool as createNovelCharacterEditTool } from "./Edit.js";
export { createCharacterReadTool as createNovelCharacterReadTool } from "./Read.js";
export { createCharacterWriteTool as createNovelCharacterWriteTool } from "./Write.js";
export * from "./schemas.js";
export {
  NovelCharacterToolService,
  type NovelCharacterToolServiceOptions,
} from "./ToolService.js";

export const NOVEL_ENTITIES_TOOL_GROUP_MANIFEST: ToolGroupManifest =
  Object.freeze({
    schemaVersion: 1,
    id: "novel.entities",
    version: "1.0.0",
    label: "Novel Entities",
    description:
      "Read, write, and edit Character and Location profiles in a conversation Draft.",
    tools: Object.freeze([
      "NovelCharacterRead",
      "NovelCharacterWrite",
      "NovelCharacterEdit",
    ]),
  });

export interface CreateNovelCharacterToolRegistryOptions {
  readonly service: NovelCharacterToolService;
  readonly logger?: Logger;
}

export function createNovelCharacterToolRegistry(
  options: CreateNovelCharacterToolRegistryOptions,
): ToolRegistry {
  return new ToolRegistry([
    createCharacterReadTool(options),
    createCharacterWriteTool(options),
    createCharacterEditTool(options),
  ]);
}
