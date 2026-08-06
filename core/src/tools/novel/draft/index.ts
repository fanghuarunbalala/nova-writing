/** Novel Draft Tools group: lifecycle actions over the conversation Draft. */
import type { Logger } from "../../../observability/index.js";
import type { ToolGroupManifest } from "../../../tooling/group/index.js";
import { ToolRegistry } from "../../../tooling/registry/index.js";
import { createDraftCommitTool } from "./Commit.js";
import { createDraftRebaseTool } from "./Rebase.js";
import { createDraftRollbackTool } from "./Rollback.js";
import { createDraftStatusTool } from "./Status.js";
import type { NovelDraftToolService } from "./ToolService.js";

export { createDraftCommitTool as createNovelDraftCommitTool } from "./Commit.js";
export { createDraftRebaseTool as createNovelDraftRebaseTool } from "./Rebase.js";
export { createDraftRollbackTool as createNovelDraftRollbackTool } from "./Rollback.js";
export { createDraftStatusTool as createNovelDraftStatusTool } from "./Status.js";
export * from "./schemas.js";
export {
  NovelDraftToolService,
  type NovelDraftToolServiceOptions,
} from "./ToolService.js";

export const NOVEL_DRAFT_TOOL_GROUP_MANIFEST: ToolGroupManifest =
  Object.freeze({
    schemaVersion: 1,
    id: "novel.draft",
    version: "1.0.0",
    label: "Novel Draft Lifecycle",
    description:
      "Inspect, commit, roll back, or rebase the conversation Draft.",
    tools: Object.freeze([
      "NovelDraftStatus",
      "NovelDraftCommit",
      "NovelDraftRollback",
      "NovelDraftRebase",
    ]),
  });

export interface CreateNovelDraftToolRegistryOptions {
  readonly service: NovelDraftToolService;
  readonly logger?: Logger;
}

export function createNovelDraftToolRegistry(
  options: CreateNovelDraftToolRegistryOptions,
): ToolRegistry {
  return new ToolRegistry([
    createDraftStatusTool(options),
    createDraftCommitTool(options),
    createDraftRollbackTool(options),
    createDraftRebaseTool(options),
  ]);
}
