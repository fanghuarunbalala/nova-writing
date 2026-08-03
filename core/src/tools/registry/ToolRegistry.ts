/** Mutable Tool assembly that freezes into a deterministic immutable Registry snapshot. */
import type { RegisteredTool } from "../protocol/RegisteredTool.js";
import { isToolName } from "../protocol/ToolName.js";
import { captureRegisteredTool } from "../protocol/ToolProtocolValidator.js";
import {
  TOOL_REGISTRY_FAILURE,
  ToolRegistryError,
} from "./ToolRegistryErrors.js";

type AnyRegisteredTool = RegisteredTool;

export class ToolRegistry {
  readonly #toolsByName: ReadonlyMap<string, AnyRegisteredTool>;
  readonly #orderedTools: readonly AnyRegisteredTool[];

  constructor(tools: Iterable<AnyRegisteredTool>) {
    const toolsByName = new Map<string, AnyRegisteredTool>();
    for (const source of tools) {
      const tool = captureRegisteredTool(source);
      const existing = toolsByName.get(tool.descriptor.name);
      if (existing) throw duplicateTool(tool);
      toolsByName.set(tool.descriptor.name, tool);
    }

    this.#toolsByName = toolsByName;
    this.#orderedTools = Object.freeze(
      [...toolsByName.values()].sort(compareToolNames),
    );
    Object.freeze(this);
  }

  get size(): number {
    return this.#orderedTools.length;
  }

  has(name: string): boolean {
    return this.#toolsByName.has(name);
  }

  get(name: string): AnyRegisteredTool | undefined {
    return this.#toolsByName.get(name);
  }

  require(name: string): AnyRegisteredTool {
    const tool = this.get(name);
    if (!tool) {
      throw new ToolRegistryError(TOOL_REGISTRY_FAILURE.unknownTool, {
        toolName: isToolName(name) ? name : undefined,
      });
    }
    return tool;
  }

  list(): readonly AnyRegisteredTool[] {
    return this.#orderedTools;
  }
}

export class ToolRegistryAssembler {
  readonly #toolsByName = new Map<string, AnyRegisteredTool>();
  #snapshot?: ToolRegistry;

  get size(): number {
    return this.#toolsByName.size;
  }

  register(source: AnyRegisteredTool): this {
    this.#assertMutable();
    const tool = captureRegisteredTool(source);
    if (this.#toolsByName.has(tool.descriptor.name)) throw duplicateTool(tool);
    this.#toolsByName.set(tool.descriptor.name, tool);
    return this;
  }

  merge(registry: ToolRegistry): this {
    this.#assertMutable();
    for (const tool of registry.list()) {
      if (this.#toolsByName.has(tool.descriptor.name)) throw duplicateTool(tool);
    }
    for (const tool of registry.list()) {
      this.#toolsByName.set(tool.descriptor.name, tool);
    }
    return this;
  }

  freeze(): ToolRegistry {
    if (!this.#snapshot) {
      this.#snapshot = new ToolRegistry(this.#toolsByName.values());
    }
    return this.#snapshot;
  }

  #assertMutable(): void {
    if (this.#snapshot) {
      throw new ToolRegistryError(TOOL_REGISTRY_FAILURE.assemblyFrozen);
    }
  }
}

function compareToolNames(
  left: AnyRegisteredTool,
  right: AnyRegisteredTool,
): number {
  if (left.descriptor.name < right.descriptor.name) return -1;
  if (left.descriptor.name > right.descriptor.name) return 1;
  return 0;
}

function duplicateTool(tool: AnyRegisteredTool): ToolRegistryError {
  return new ToolRegistryError(TOOL_REGISTRY_FAILURE.duplicateTool, {
    toolName: tool.descriptor.name,
    toolVersion: tool.descriptor.version,
  });
}
