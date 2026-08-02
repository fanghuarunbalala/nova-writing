/** Immutable Agent capability view composed from Groups, allowlist, then denylist. */
import type { ToolGroupCatalog } from "../group/ToolGroupCatalog.js";
import type { RegisteredTool } from "../protocol/RegisteredTool.js";
import type { ToolRegistry } from "./ToolRegistry.js";
import {
  TOOL_REGISTRY_VIEW_FAILURE,
  ToolRegistryViewError,
  type ToolRegistryViewFailure,
} from "./ToolRegistryViewErrors.js";

const GROUP_ID = /^[a-z][a-z0-9_]{0,63}$/;
const TOOL_NAME = /^[a-z][a-z0-9_]{0,63}$/;
const POLICY_FIELDS = new Set(["groupIds", "allow", "deny"]);

export interface ToolRegistryViewPolicy {
  readonly groupIds: readonly string[];
  readonly allow?: readonly string[];
  readonly deny?: readonly string[];
}

export interface ToolRegistryViewOptions {
  readonly registry: ToolRegistry;
  readonly groups: ToolGroupCatalog;
  readonly policy: ToolRegistryViewPolicy;
}

export class ToolRegistryView {
  readonly policy: ToolRegistryViewPolicy;
  readonly #toolsByName: ReadonlyMap<string, RegisteredTool>;
  readonly #orderedTools: readonly RegisteredTool[];

  constructor(options: ToolRegistryViewOptions) {
    this.policy = captureViewPolicy(options.policy);

    const candidates = new Map<string, RegisteredTool>();
    for (const groupId of this.policy.groupIds) {
      const manifest = options.groups.require(groupId);
      for (const toolName of manifest.tools) {
        const tool = options.registry.get(toolName);
        if (!tool) throw unknownTool(toolName, groupId);
        if (!candidates.has(toolName)) candidates.set(toolName, tool);
      }
    }

    const allow = validateKnownTools(
      options.registry,
      this.policy.allow,
      TOOL_REGISTRY_VIEW_FAILURE.duplicateAllowTool,
    );
    const deny = validateKnownTools(
      options.registry,
      this.policy.deny,
      TOOL_REGISTRY_VIEW_FAILURE.duplicateDenyTool,
    );
    const orderedTools = [...candidates.values()].filter(
      (tool) =>
        (allow === undefined || allow.has(tool.descriptor.name)) &&
        !deny?.has(tool.descriptor.name),
    );

    this.#toolsByName = new Map(
      orderedTools.map((tool) => [tool.descriptor.name, tool]),
    );
    this.#orderedTools = Object.freeze(orderedTools);
    Object.freeze(this);
  }

  get size(): number {
    return this.#orderedTools.length;
  }

  has(name: string): boolean {
    return this.#toolsByName.has(name);
  }

  get(name: string): RegisteredTool | undefined {
    return this.#toolsByName.get(name);
  }

  require(name: string): RegisteredTool {
    const tool = this.get(name);
    if (!tool) throw unknownTool(name);
    return tool;
  }

  listAllowed(): readonly RegisteredTool[] {
    return this.#orderedTools;
  }
}

function captureViewPolicy(value: unknown): ToolRegistryViewPolicy {
  const record = capturePlainRecord(value);
  if (!record || Object.keys(record).some((key) => !POLICY_FIELDS.has(key))) {
    throw viewFailure(TOOL_REGISTRY_VIEW_FAILURE.invalidPolicy);
  }

  const groupIds = captureIdentityList(
    record.groupIds,
    GROUP_ID,
    TOOL_REGISTRY_VIEW_FAILURE.duplicateGroupSelection,
  );
  const allow = captureOptionalIdentityList(
    record.allow,
    TOOL_NAME,
    TOOL_REGISTRY_VIEW_FAILURE.duplicateAllowTool,
  );
  const deny = captureOptionalIdentityList(
    record.deny,
    TOOL_NAME,
    TOOL_REGISTRY_VIEW_FAILURE.duplicateDenyTool,
  );
  return Object.freeze({
    groupIds,
    ...(allow === undefined ? {} : { allow }),
    ...(deny === undefined ? {} : { deny }),
  });
}

function captureOptionalIdentityList(
  value: unknown,
  pattern: RegExp,
  duplicateFailure: ToolRegistryViewFailure,
): readonly string[] | undefined {
  return value === undefined
    ? undefined
    : captureIdentityList(value, pattern, duplicateFailure);
}

function captureIdentityList(
  value: unknown,
  pattern: RegExp,
  duplicateFailure: ToolRegistryViewFailure,
): readonly string[] {
  try {
    if (!Array.isArray(value)) throw new Error();
    const captured: string[] = [];
    const seen = new Set<string>();
    for (const identity of value) {
      if (typeof identity !== "string" || !pattern.test(identity)) {
        throw viewFailure(TOOL_REGISTRY_VIEW_FAILURE.invalidPolicy);
      }
      if (seen.has(identity)) {
        throw viewFailure(duplicateFailure, {
          ...(pattern === GROUP_ID
            ? { groupId: identity }
            : { toolName: identity }),
        });
      }
      seen.add(identity);
      captured.push(identity);
    }
    return Object.freeze(captured);
  } catch (error) {
    if (error instanceof ToolRegistryViewError) throw error;
    throw viewFailure(TOOL_REGISTRY_VIEW_FAILURE.invalidPolicy);
  }
}

function validateKnownTools(
  registry: ToolRegistry,
  names: readonly string[] | undefined,
  duplicateFailure: ToolRegistryViewFailure,
): ReadonlySet<string> | undefined {
  if (names === undefined) return undefined;
  const known = new Set<string>();
  for (const name of names) {
    if (known.has(name)) {
      throw viewFailure(duplicateFailure, { toolName: name });
    }
    if (!registry.has(name)) throw unknownTool(name);
    known.add(name);
  }
  return known;
}

function unknownTool(name: string, groupId?: string): ToolRegistryViewError {
  return viewFailure(TOOL_REGISTRY_VIEW_FAILURE.unknownTool, {
    groupId,
    toolName: TOOL_NAME.test(name) ? name : undefined,
  });
}

function viewFailure(
  failure: ToolRegistryViewFailure,
  identity: { readonly groupId?: string; readonly toolName?: string } = {},
): ToolRegistryViewError {
  return new ToolRegistryViewError(failure, identity);
}

function capturePlainRecord(
  value: unknown,
): Record<string, unknown> | undefined {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    if (Object.getOwnPropertySymbols(value).length > 0) return undefined;

    const captured: Record<string, unknown> = Object.create(null);
    for (const [key, descriptor] of Object.entries(
      Object.getOwnPropertyDescriptors(value),
    )) {
      if (!descriptor.enumerable || !("value" in descriptor)) return undefined;
      captured[key] = descriptor.value;
    }
    return captured;
  } catch {
    return undefined;
  }
}
