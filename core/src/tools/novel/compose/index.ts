/** novel.compose 工具组：Enter/ExitComposeMode 注册入口。 */
/** novel.compose tool group: Enter/ExitComposeMode registration entry. */
import type { Logger } from "../../../observability/index.js";
import type { ToolGroupManifest } from "../../../tooling/group/index.js";
import { ToolRegistry } from "../../../tooling/registry/index.js";
import { createEnterComposeModeTool } from "./Enter.js";
import { createExitComposeModeTool } from "./Exit.js";
import type { ComposeToolService } from "./ToolService.js";

export { createEnterComposeModeTool } from "./Enter.js";
export { createExitComposeModeTool } from "./Exit.js";
export * from "./schemas.js";
export {
  ComposeToolService,
  type ComposeEnterDetails,
  type ComposeExitDetails,
  type ConversationModePersistencePort,
} from "./ToolService.js";

export const NOVEL_COMPOSE_TOOL_GROUP_MANIFEST: ToolGroupManifest =
  Object.freeze({
    schemaVersion: 1,
    id: "novel.compose",
    version: "1.0.0",
    label: "Novel Compose Mode",
    description:
      "Enter and exit compose mode: draft content in the design file, then submit it for author approval.",
    tools: Object.freeze(["EnterComposeMode", "ExitComposeMode"]),
  });

export interface CreateNovelComposeToolRegistryOptions {
  readonly service: ComposeToolService;
  readonly logger?: Logger;
}

/** 组装 compose 工具注册表。Assembles the compose tool registry. */
export function createNovelComposeToolRegistry(
  options: CreateNovelComposeToolRegistryOptions,
): ToolRegistry {
  return new ToolRegistry([
    createEnterComposeModeTool(options),
    createExitComposeModeTool(options),
  ]);
}
