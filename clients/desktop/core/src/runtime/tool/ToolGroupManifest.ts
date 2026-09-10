/**
 * 不可变工具组清单：有序工具名（id/version/label 为展示层元数据；
 * 工具本体由组工厂按 tools 名解析，见 groups/NovelToolGroups.ts）。
 * Immutable Tool Group manifest: ordered tool names (id/version/label are display
 * metadata; tool bodies are resolved by the group factory from the tool names).
 */
import { captureIdentity, captureVersion } from "../prompt/PromptRecipe.js";

/** 工具组清单 schema 版本 */
export const TOOL_GROUP_MANIFEST_SCHEMA_VERSION = 1 as const;

/** 工具组清单快照（持久化边界） */
export interface ToolGroupManifestSnapshot {
  readonly schemaVersion: typeof TOOL_GROUP_MANIFEST_SCHEMA_VERSION;
  readonly id: string;
  readonly version: string;
  readonly label: string;
  readonly description?: string;
  readonly tools: readonly string[];
}

/** 工具组清单构造选项 */
export interface ToolGroupManifestOptions {
  readonly id: string;
  readonly version: string;
  readonly label: string;
  readonly description?: string;
  readonly tools: readonly string[];
}

/**
 * 不可变工具组清单：校验 id/version/label/tools（非空、有序、唯一）+ 冻结。
 * Immutable tool group manifest: validates id/version/label/tools
 * (non-empty, ordered, unique) and freezes.
 */
export class ToolGroupManifest {
  readonly schemaVersion = TOOL_GROUP_MANIFEST_SCHEMA_VERSION;
  readonly id: string;
  readonly version: string;
  readonly label: string;
  readonly description?: string;
  readonly tools: readonly string[];

  /**
   * 构造工具组清单
   * @param options 清单选项
   */
  constructor(options: ToolGroupManifestOptions) {
    this.id = captureIdentity(options.id, "Tool Group id");
    this.version = captureVersion(options.version);
    if (typeof options.label !== "string" || options.label.trim().length === 0) {
      throw new TypeError("Tool Group label is invalid");
    }
    this.label = options.label;
    this.description =
      options.description === undefined || options.description.trim().length === 0
        ? undefined
        : options.description;
    if (!Array.isArray(options.tools) || options.tools.length === 0) {
      throw new TypeError("Tool Group tools are invalid");
    }
    const seen = new Set<string>();
    this.tools = Object.freeze(
      options.tools.map((tool) => {
        const captured = captureIdentity(tool, "Tool Group tool");
        if (seen.has(captured)) {
          throw new TypeError("Tool Group tools must be unique");
        }
        seen.add(captured);
        return captured;
      }),
    );
    Object.freeze(this);
  }

  /** 持久化边界快照 */
  toSnapshot(): ToolGroupManifestSnapshot {
    return Object.freeze({
      schemaVersion: this.schemaVersion,
      id: this.id,
      version: this.version,
      label: this.label,
      ...(this.description === undefined ? {} : { description: this.description }),
      tools: this.tools,
    });
  }
}
