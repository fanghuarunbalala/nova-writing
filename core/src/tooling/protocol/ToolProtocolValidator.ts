/** Defensively captures immutable Tool protocol values without retaining private data. */
import { IsSchema, type Static, type TSchema } from "typebox";
import { Compile } from "typebox/compile";
import {
  canonicalStringifyJson,
  isJsonValue,
  type JsonValue,
} from "../../event/protocol/index.js";
import {
  captureArtifactReference,
  type ArtifactReference,
} from "../../storage/artifact/index.js";
import type { ToolDescriptor } from "./ToolDescriptor.js";
import { ToolPromptDetails } from "./ToolPromptDetails.js";
import type { ToolHandler } from "./ToolHandler.js";
import { isToolName } from "./ToolName.js";
import type {
  ToolExecutionUpdate,
  ToolPartialResultUpdate,
  ToolProgressUpdate,
} from "./ToolProgress.js";
import {
  TOOL_PROTOCOL_FAILURE,
  ToolProtocolError,
  type ToolProtocolErrorIdentity,
  type ToolProtocolFailure,
} from "./ToolProtocolErrors.js";
import type { RegisteredTool } from "./RegisteredTool.js";
import type {
  ToolResult,
  ToolResultCaptureOptions,
  ToolResultContent,
  ToolResultLimits,
} from "./ToolResult.js";

const TOOL_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const SAFE_IDENTITY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const textEncoder = new TextEncoder();

export function captureToolDescriptor<TParameters extends TSchema>(
  value: ToolDescriptor<TParameters>,
): ToolDescriptor<TParameters>;
export function captureToolDescriptor(value: unknown): ToolDescriptor;
export function captureToolDescriptor(value: unknown): ToolDescriptor {
  const record = asPlainRecord(value);
  const identity = descriptorIdentity(record);
  if (!record) throw failure(TOOL_PROTOCOL_FAILURE.invalidDescriptor, identity);

  const name = captureToolName(record.name);
  if (!name) throw failure(TOOL_PROTOCOL_FAILURE.invalidName);
  const version = captureToolVersion(record.version);
  if (!version) {
    throw failure(TOOL_PROTOCOL_FAILURE.invalidVersion, { toolName: name });
  }

  let parameters: TSchema;
  try {
    parameters = captureTypeBoxSchema(record.parameters);
  } catch {
    throw failure(TOOL_PROTOCOL_FAILURE.invalidSchema, {
      toolName: name,
      toolVersion: version,
    });
  }

  try {
    const promptDetails = record.promptDetails === undefined
      ? undefined
      : record.promptDetails instanceof ToolPromptDetails
      ? record.promptDetails
      : new ToolPromptDetails(record.promptDetails as Record<string, unknown>);
    return Object.freeze({
      name,
      version,
      label: requireNonBlank(record.label),
      description: requireNonBlank(record.description),
      parameters,
      ...(promptDetails === undefined ? {} : { promptDetails }),
    });
  } catch {
    throw failure(TOOL_PROTOCOL_FAILURE.invalidDescriptor, {
      toolName: name,
      toolVersion: version,
    });
  }
}

export function captureRegisteredTool<
  TParameters extends TSchema,
  TDetails extends JsonValue = JsonValue,
>(
  value: RegisteredTool<TParameters, TDetails>,
): RegisteredTool<TParameters, TDetails>;
export function captureRegisteredTool(value: unknown): RegisteredTool;
export function captureRegisteredTool(value: unknown): RegisteredTool {
  const record = asPlainRecord(value);
  if (!record) throw failure(TOOL_PROTOCOL_FAILURE.invalidDescriptor);

  const descriptor = captureToolDescriptor(record.descriptor);
  const handler = captureToolHandler(record.handler, {
    toolName: descriptor.name,
    toolVersion: descriptor.version,
  });
  return Object.freeze({ descriptor, handler });
}

export function defineTool<
  TParameters extends TSchema,
  TDetails extends JsonValue = JsonValue,
>(
  value: RegisteredTool<TParameters, TDetails>,
): RegisteredTool<TParameters, TDetails> {
  return captureRegisteredTool(value);
}

export function captureToolArguments<TParameters extends TSchema>(
  descriptorSource: ToolDescriptor<TParameters>,
  value: unknown,
): Static<TParameters> {
  const descriptor = captureToolDescriptor(descriptorSource);
  const identity = {
    toolName: descriptor.name,
    toolVersion: descriptor.version,
  };
  try {
    if (!isJsonValue(value)) throw new Error();
    const captured = cloneJson(value);
    if (!Compile(descriptor.parameters).Check(captured)) throw new Error();
    return captured as Static<TParameters>;
  } catch {
    throw failure(TOOL_PROTOCOL_FAILURE.invalidArguments, identity);
  }
}

export function captureToolResult<TDetails extends JsonValue = JsonValue>(
  value: unknown,
  options: ToolResultCaptureOptions,
): ToolResult<TDetails> {
  const identity = captureResultIdentity(options);
  const record = asPlainRecord(value);
  if (!record) throw failure(TOOL_PROTOCOL_FAILURE.invalidResult, identity);

  const limits = captureResultLimits(options?.limits, identity);
  const conversationId = captureSafeIdentity(options?.conversationId);
  if (!conversationId) {
    throw failure(TOOL_PROTOCOL_FAILURE.invalidResult, identity);
  }

  let content: readonly ToolResultContent[];
  try {
    content = captureToolContent(record.content);
  } catch {
    throw failure(TOOL_PROTOCOL_FAILURE.invalidContent, identity);
  }

  let details: JsonValue | undefined;
  if (record.details !== undefined) {
    try {
      if (!isJsonValue(record.details)) throw new Error();
      details = cloneJson(record.details);
    } catch {
      throw failure(TOOL_PROTOCOL_FAILURE.invalidDetails, identity);
    }
  }

  let artifacts: readonly ArtifactReference[] | undefined;
  if (record.artifacts !== undefined) {
    try {
      if (!Array.isArray(record.artifacts)) throw new Error();
      artifacts = Object.freeze(
        record.artifacts.map((artifact) => captureArtifactReference(artifact)),
      );
    } catch {
      throw failure(TOOL_PROTOCOL_FAILURE.invalidResult, identity);
    }
    if (artifacts.some((artifact) => artifact.conversationId !== conversationId)) {
      throw failure(
        TOOL_PROTOCOL_FAILURE.artifactConversationMismatch,
        identity,
      );
    }
  }

  if (
    content.length > limits.maximumContentBlocks ||
    textByteLength(content) > limits.maximumTextBytes ||
    detailsByteLength(details) > limits.maximumDetailsBytes ||
    (artifacts?.length ?? 0) > limits.maximumArtifactReferences
  ) {
    throw failure(TOOL_PROTOCOL_FAILURE.resultOversized, identity);
  }

  return Object.freeze({
    content,
    ...(details === undefined ? {} : { details: details as TDetails }),
    ...(artifacts === undefined ? {} : { artifacts }),
  });
}

export function captureToolExecutionUpdate(value: unknown): ToolExecutionUpdate {
  const record = asPlainRecord(value);
  if (!record) throw failure(TOOL_PROTOCOL_FAILURE.invalidProgress);

  try {
    if (record.kind === "progress") return captureProgressUpdate(record);
    if (record.kind === "partial_result") {
      return capturePartialResultUpdate(record);
    }
  } catch {
    throw failure(TOOL_PROTOCOL_FAILURE.invalidProgress);
  }
  throw failure(TOOL_PROTOCOL_FAILURE.invalidProgress);
}

function captureToolHandler(
  value: unknown,
  identity: ToolProtocolErrorIdentity,
): ToolHandler {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) {
    throw failure(TOOL_PROTOCOL_FAILURE.invalidHandler, identity);
  }
  const execute = (value as { execute?: unknown }).execute;
  if (typeof execute !== "function") {
    throw failure(TOOL_PROTOCOL_FAILURE.invalidHandler, identity);
  }
  return Object.freeze({
    execute: execute.bind(value) as ToolHandler["execute"],
  });
}

function captureTypeBoxSchema(value: unknown): TSchema {
  if (!IsSchema(value) || !asPlainRecord(value)) throw new Error();
  const captured = cloneSchemaValue(value, new Set<object>());
  const record = asPlainRecord(captured);
  if (
    !record ||
    typeof record["~kind"] !== "string" ||
    record["~kind"].trim().length === 0 ||
    !IsSchema(captured)
  ) {
    throw new Error();
  }
  Compile(captured as TSchema);
  return captured as TSchema;
}

function cloneSchemaValue(value: unknown, seen: Set<object>): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error();
    return value;
  }
  if (typeof value !== "object" || seen.has(value)) throw new Error();

  seen.add(value);
  if (Array.isArray(value)) {
    const captured = value.map((item) => cloneSchemaValue(item, seen));
    seen.delete(value);
    return Object.freeze(captured);
  }

  const record = asPlainRecord(value);
  if (!record) throw new Error();
  const captured: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(record)) {
    if (typeof key !== "string") throw new Error();
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor || !("value" in descriptor)) throw new Error();
    captured[key] = cloneSchemaValue(descriptor.value, seen);
  }
  seen.delete(value);
  return Object.freeze(captured);
}

function captureToolContent(value: unknown): readonly ToolResultContent[] {
  if (!Array.isArray(value)) throw new Error();
  return Object.freeze(
    value.map((entry): ToolResultContent => {
      const record = asPlainRecord(entry);
      if (!record || record.type !== "text" || typeof record.text !== "string") {
        throw new Error();
      }
      return Object.freeze({ type: "text", text: record.text });
    }),
  );
}

function captureProgressUpdate(
  record: Record<string, unknown>,
): ToolProgressUpdate {
  const message = record.message;
  if (message !== undefined && typeof message !== "string") throw new Error();
  const completed = captureOptionalNonNegativeInteger(record.completed);
  const total = captureOptionalNonNegativeInteger(record.total);
  if (completed !== undefined && total !== undefined && completed > total) {
    throw new Error();
  }
  return Object.freeze({
    kind: "progress",
    ...(message === undefined ? {} : { message }),
    ...(completed === undefined ? {} : { completed }),
    ...(total === undefined ? {} : { total }),
  });
}

function capturePartialResultUpdate(
  record: Record<string, unknown>,
): ToolPartialResultUpdate {
  return Object.freeze({
    kind: "partial_result",
    content: captureToolContent(record.content),
  });
}

function captureResultLimits(
  value: unknown,
  identity: ToolProtocolErrorIdentity,
): ToolResultLimits {
  const record = asPlainRecord(value);
  try {
    if (!record) throw new Error();
    return Object.freeze({
      maximumContentBlocks: requireNonNegativeInteger(
        record.maximumContentBlocks,
      ),
      maximumTextBytes: requireNonNegativeInteger(record.maximumTextBytes),
      maximumDetailsBytes: requireNonNegativeInteger(record.maximumDetailsBytes),
      maximumArtifactReferences: requireNonNegativeInteger(
        record.maximumArtifactReferences,
      ),
    });
  } catch {
    throw failure(TOOL_PROTOCOL_FAILURE.invalidResult, identity);
  }
}

function textByteLength(content: readonly ToolResultContent[]): number {
  return content.reduce(
    (total, block) => total + textEncoder.encode(block.text).byteLength,
    0,
  );
}

function detailsByteLength(details: JsonValue | undefined): number {
  return details === undefined
    ? 0
    : textEncoder.encode(canonicalStringifyJson(details)).byteLength;
}

function cloneJson<T extends JsonValue>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => cloneJson(item))) as T;
  }
  return Object.freeze(
    Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, cloneJson(child)]),
    ),
  ) as T;
}

function captureResultIdentity(
  value: ToolResultCaptureOptions | undefined,
): ToolProtocolErrorIdentity {
  return Object.freeze({
    toolName: captureToolName(value?.toolName),
    toolVersion: captureToolVersion(value?.toolVersion),
    conversationId: captureSafeIdentity(value?.conversationId),
    toolCallId: captureSafeIdentity(value?.toolCallId),
  });
}

function descriptorIdentity(
  value: Record<string, unknown> | undefined,
): ToolProtocolErrorIdentity {
  return Object.freeze({
    toolName: captureToolName(value?.name),
    toolVersion: captureToolVersion(value?.version),
  });
}

function failure(
  failureType: ToolProtocolFailure,
  identity: ToolProtocolErrorIdentity = {},
): ToolProtocolError {
  return new ToolProtocolError(failureType, identity);
}

function asPlainRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null
    ? (value as Record<string, unknown>)
    : undefined;
}

function requireNonBlank(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error();
  return value;
}

function captureToolName(value: unknown): string | undefined {
  return isToolName(value) ? value : undefined;
}

function captureToolVersion(value: unknown): string | undefined {
  return typeof value === "string" &&
    value.length <= 64 &&
    TOOL_VERSION.test(value)
    ? value
    : undefined;
}

function captureSafeIdentity(value: unknown): string | undefined {
  return typeof value === "string" && SAFE_IDENTITY.test(value)
    ? value
    : undefined;
}

function requireNonNegativeInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error();
  }
  return value;
}

function captureOptionalNonNegativeInteger(
  value: unknown,
): number | undefined {
  return value === undefined ? undefined : requireNonNegativeInteger(value);
}
