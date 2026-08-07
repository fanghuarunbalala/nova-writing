/** runtime.files 工具组：Read/Glob/Write/Edit 的注册与导出入口。 */
/** runtime.files tool group: registration and export entry for Read/Glob/Write/Edit. */
import type { Logger } from "../../observability/index.js";
import type { ToolGroupManifest } from "../../tooling/group/index.js";
import { ToolRegistry } from "../../tooling/registry/index.js";
import { createFileEditTool } from "./Edit.js";
import { createFileGlobTool } from "./Glob.js";
import { createFileReadTool } from "./Read.js";
import type { FileToolService } from "./ToolService.js";
import { createFileWriteTool } from "./Write.js";

export { createFileEditTool } from "./Edit.js";
export { createFileGlobTool } from "./Glob.js";
export { createFileReadTool } from "./Read.js";
export { createFileWriteTool } from "./Write.js";
export * from "./schemas.js";
export {
  FILE_TOOL_ERROR_CODE,
  FileToolError,
  FileToolService,
  type FileEditDetails,
  type FileGlobDetails,
  type FileReadDetails,
  type FileWriteDetails,
} from "./ToolService.js";

export const RUNTIME_FILES_TOOL_GROUP_MANIFEST: ToolGroupManifest =
  Object.freeze({
    schemaVersion: 1,
    id: "runtime.files",
    version: "1.0.0",
    label: "Runtime Files",
    description:
      "Read, Glob, Write, and Edit design-directory files during compose mode.",
    tools: Object.freeze(["Read", "Glob", "Write", "Edit"]),
  });

export interface CreateFileToolRegistryOptions {
  readonly service: FileToolService;
  readonly logger?: Logger;
}

/** 组装 4 个文件工具为注册表。Assembles the four file tools into a registry. */
export function createFileToolRegistry(
  options: CreateFileToolRegistryOptions,
): ToolRegistry {
  return new ToolRegistry([
    createFileReadTool(options),
    createFileGlobTool(options),
    createFileWriteTool(options),
    createFileEditTool(options),
  ]);
}
