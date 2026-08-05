/**
 * Opt-in debug snapshot of one provider request. Only constructed when a debug
 * recorder is configured; secrets and credential references are never copied.
 */
import type { StreamFn } from "@earendil-works/pi-agent-core";
import type { Context, SimpleStreamOptions } from "@earendil-works/pi-ai";
import type { EffectiveModelExecutionDescriptor } from "../../../config/index.js";
import type { JsonValue } from "../../../event/index.js";

export const PROVIDER_REQUEST_DEBUG_LIMITS = Object.freeze({
  maximumMessageCount: 500,
  maximumMessageBytes: 65_536,
  maximumToolsBytes: 262_144,
  maximumPromptBytes: 262_144,
} as const);

export type ProviderRequestDebugSnapshot = {
  readonly recordedAt: string;
  readonly api: string;
  readonly model: {
    readonly id: string;
    readonly name: string;
    readonly provider: string;
    readonly baseUrl: string;
    readonly reasoning: boolean;
    readonly contextWindow: number;
    readonly maxTokens: number;
  };
  readonly config: {
    readonly modelProfileId: string;
    readonly modelConnectionId: string;
    readonly providerKind: string;
    readonly api: string;
    readonly modelId: string;
    readonly baseUrl?: string;
    readonly organizationId?: string;
    readonly projectId?: string;
    readonly apiVersion?: string;
    readonly region?: string;
    readonly parameters: JsonValue;
    readonly capabilityOverrides: JsonValue;
    readonly fallbackProfileIds: string[];
  };
  readonly options: {
    readonly temperature?: number;
    readonly maxTokens?: number;
    readonly reasoning?: string;
  };
  readonly prompt?: string;
  readonly messages: JsonValue[];
  readonly tools: JsonValue[];
};

export type ProviderRequestDebugModel = Parameters<StreamFn>[0];

export interface ProviderRequestDebugRecorder {
  record(snapshot: ProviderRequestDebugSnapshot): Promise<void>;
}

export function captureProviderRequestDebugSnapshot(
  input: {
    readonly recordedAt: string;
    readonly descriptor: EffectiveModelExecutionDescriptor;
    readonly model: ProviderRequestDebugModel;
    readonly context: Context;
    readonly options: SimpleStreamOptions;
  },
): ProviderRequestDebugSnapshot {
  return {
    recordedAt: input.recordedAt,
    api: input.descriptor.api,
    model: {
      id: input.model.id,
      name: input.model.name,
      provider: input.model.provider,
      baseUrl: input.model.baseUrl,
      reasoning: input.model.reasoning,
      contextWindow: input.model.contextWindow,
      maxTokens: input.model.maxTokens,
    },
    config: {
      modelProfileId: input.descriptor.modelProfileId,
      modelConnectionId: input.descriptor.modelConnectionId,
      providerKind: input.descriptor.providerKind,
      api: input.descriptor.api,
      modelId: input.descriptor.modelId,
      ...(input.descriptor.baseUrl === undefined
        ? {}
        : { baseUrl: input.descriptor.baseUrl }),
      ...(input.descriptor.organizationId === undefined
        ? {}
        : { organizationId: input.descriptor.organizationId }),
      ...(input.descriptor.projectId === undefined
        ? {}
        : { projectId: input.descriptor.projectId }),
      ...(input.descriptor.apiVersion === undefined
        ? {}
        : { apiVersion: input.descriptor.apiVersion }),
      ...(input.descriptor.region === undefined
        ? {}
        : { region: input.descriptor.region }),
      parameters: input.descriptor.parameters as unknown as JsonValue,
      capabilityOverrides:
        input.descriptor.capabilityOverrides as unknown as JsonValue,
      fallbackProfileIds: [...input.descriptor.fallbackProfileIds],
    },
    options: {
      ...(input.options.temperature === undefined
        ? {}
        : { temperature: input.options.temperature }),
      ...(input.options.maxTokens === undefined
        ? {}
        : { maxTokens: input.options.maxTokens }),
      ...(input.options.reasoning === undefined
        ? {}
        : { reasoning: input.options.reasoning }),
    },
    ...(input.context.systemPrompt === undefined
      ? {}
      : { prompt: boundText(input.context.systemPrompt, "prompt") }),
    messages: boundMessages(input.context.messages),
    tools: boundTools(input.context.tools ?? []),
  };
}

function boundMessages(messages: Context["messages"]): JsonValue[] {
  const recent = messages.slice(-PROVIDER_REQUEST_DEBUG_LIMITS.maximumMessageCount);
  return recent.map((message) => {
    const serialized = safeSerialize(message);
    return boundBytes(serialized, PROVIDER_REQUEST_DEBUG_LIMITS.maximumMessageBytes)
      ? (JSON.parse(serialized) as JsonValue)
      : {
          role: (message as { role?: string }).role ?? "unknown",
          truncated: true,
          bytes: utf8ByteLength(serialized),
        };
  });
}

function boundTools(tools: NonNullable<Context["tools"]>): JsonValue[] {
  return tools.map((tool) => {
    const serialized = safeSerialize(tool);
    return boundBytes(serialized, PROVIDER_REQUEST_DEBUG_LIMITS.maximumToolsBytes)
      ? (JSON.parse(serialized) as JsonValue)
      : {
          name: tool.name,
          truncated: true,
          bytes: utf8ByteLength(serialized),
        };
  });
}

function boundText(value: string, field: "prompt"): string | undefined {
  const bytes = utf8ByteLength(value);
  if (bytes <= PROVIDER_REQUEST_DEBUG_LIMITS.maximumPromptBytes) return value;
  return `${value.slice(0, Math.floor(PROVIDER_REQUEST_DEBUG_LIMITS.maximumPromptBytes / 2))}...truncated(${bytes} bytes)`;
}

function safeSerialize(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ serializationFailed: true });
  }
}

function boundBytes(serialized: string, maximumBytes: number): boolean {
  return utf8ByteLength(serialized) <= maximumBytes;
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
