/** Strict YAML loader and defensive capture for Tool Group Manifests. */
import { parseDocument } from "yaml";
import { isToolName } from "../protocol/ToolName.js";
import {
  TOOL_GROUP_MANIFEST_SCHEMA_VERSION,
  type ToolGroupManifest,
} from "./ToolGroupManifest.js";
import {
  TOOL_GROUP_MANIFEST_FAILURE,
  ToolGroupManifestError,
  type ToolGroupManifestErrorIdentity,
  type ToolGroupManifestFailure,
} from "./ToolGroupManifestErrors.js";

const GROUP_ID = /^[a-z][a-z0-9_]{0,63}$/;
const SEMANTIC_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const MANIFEST_FIELDS = new Set([
  "schemaVersion",
  "id",
  "version",
  "label",
  "description",
  "tools",
]);

export function loadToolGroupManifest(source: string): ToolGroupManifest {
  let value: unknown;
  try {
    if (typeof source !== "string") throw new Error();
    const document = parseDocument(source, {
      version: "1.2",
      schema: "core",
      merge: false,
      prettyErrors: false,
      strict: true,
      stringKeys: true,
      uniqueKeys: true,
    });
    if (document.errors.length > 0 || document.warnings.length > 0) {
      throw new Error();
    }
    value = document.toJS({ maxAliasCount: 0 });
  } catch {
    throw manifestFailure(TOOL_GROUP_MANIFEST_FAILURE.parseFailed);
  }
  return captureToolGroupManifest(value);
}

export function captureToolGroupManifest(value: unknown): ToolGroupManifest {
  const record = capturePlainRecord(value);
  const identity = manifestIdentity(record);
  if (!record || Object.keys(record).some((key) => !MANIFEST_FIELDS.has(key))) {
    throw manifestFailure(
      TOOL_GROUP_MANIFEST_FAILURE.invalidStructure,
      identity,
    );
  }
  if (record.schemaVersion !== TOOL_GROUP_MANIFEST_SCHEMA_VERSION) {
    throw manifestFailure(
      TOOL_GROUP_MANIFEST_FAILURE.unsupportedSchemaVersion,
      identity,
    );
  }

  const id = captureGroupId(record.id);
  if (!id) {
    throw manifestFailure(TOOL_GROUP_MANIFEST_FAILURE.invalidGroupId);
  }
  const version = captureSemanticVersion(record.version);
  if (!version) {
    throw manifestFailure(TOOL_GROUP_MANIFEST_FAILURE.invalidGroupVersion, {
      groupId: id,
    });
  }

  let label: string;
  let description: string | undefined;
  try {
    label = requireNonBlank(record.label);
    description =
      record.description === undefined
        ? undefined
        : requireNonBlank(record.description);
  } catch {
    throw manifestFailure(TOOL_GROUP_MANIFEST_FAILURE.invalidMetadata, {
      groupId: id,
      groupVersion: version,
    });
  }

  let tools: readonly string[];
  try {
    tools = captureToolNames(record.tools, {
      groupId: id,
      groupVersion: version,
    });
  } catch (error) {
    if (error instanceof ToolGroupManifestError) throw error;
    throw manifestFailure(TOOL_GROUP_MANIFEST_FAILURE.invalidToolList, {
      groupId: id,
      groupVersion: version,
    });
  }
  return Object.freeze({
    schemaVersion: TOOL_GROUP_MANIFEST_SCHEMA_VERSION,
    id,
    version,
    label,
    ...(description === undefined ? {} : { description }),
    tools,
  });
}

function captureToolNames(
  value: unknown,
  identity: ToolGroupManifestErrorIdentity,
): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw manifestFailure(TOOL_GROUP_MANIFEST_FAILURE.invalidToolList, identity);
  }

  const names: string[] = [];
  const seen = new Set<string>();
  for (const valueEntry of value) {
    if (!isToolName(valueEntry)) {
      throw manifestFailure(
        TOOL_GROUP_MANIFEST_FAILURE.invalidToolName,
        identity,
      );
    }
    if (seen.has(valueEntry)) {
      throw manifestFailure(TOOL_GROUP_MANIFEST_FAILURE.duplicateTool, {
        ...identity,
        toolName: valueEntry,
      });
    }
    seen.add(valueEntry);
    names.push(valueEntry);
  }
  return Object.freeze(names);
}

function manifestIdentity(
  value: Record<string, unknown> | undefined,
): ToolGroupManifestErrorIdentity {
  return Object.freeze({
    groupId: captureGroupId(value?.id),
    groupVersion: captureSemanticVersion(value?.version),
  });
}

function manifestFailure(
  failure: ToolGroupManifestFailure,
  identity: ToolGroupManifestErrorIdentity = {},
): ToolGroupManifestError {
  return new ToolGroupManifestError(failure, identity);
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

function captureGroupId(value: unknown): string | undefined {
  return typeof value === "string" && GROUP_ID.test(value) ? value : undefined;
}

function captureSemanticVersion(value: unknown): string | undefined {
  return typeof value === "string" &&
    value.length <= 64 &&
    SEMANTIC_VERSION.test(value)
    ? value
    : undefined;
}

function requireNonBlank(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error();
  return value;
}
