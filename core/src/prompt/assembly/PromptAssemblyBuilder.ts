/** Deterministically assembles Base Prompt, overlays, and canonical Messages. */
import {
  canonicalStringifyJson,
  type JsonValue,
} from "../../event/index.js";
import { noopLogger, type Logger } from "../../observability/index.js";
import {
  coreRuntimeMessageSchemaRegistry,
  type RuntimeMessageSchemaRegistry,
  type RuntimeMessageSnapshot,
} from "../../runtime/message/index.js";
import type { CompiledSystemPrompt } from "../CompiledSystemPrompt.js";
import type { PromptDigester } from "../PromptDigester.js";
import {
  PromptAssembly,
} from "./PromptAssembly.js";
import {
  PromptContribution,
  type PromptContributionKind,
  type PromptLayerKind,
  type PromptContributionPersistence,
} from "./PromptContribution.js";
import {
  PROMPT_ASSEMBLY_FAILURE,
  PromptAssemblyError,
} from "./PromptAssemblyErrors.js";

export interface PromptContributionInput {
  readonly kind: PromptContributionKind;
  readonly sourceId: string;
  readonly sourceVersion?: string;
  readonly layer: PromptLayerKind;
  readonly persistence: PromptContributionPersistence;
  readonly order: number;
  readonly content: string;
}

export interface PromptAssemblyBuildRequest {
  readonly conversationId: string;
  readonly runId: string;
  readonly basePrompt: CompiledSystemPrompt;
  readonly checkpointOverlays?: readonly PromptContributionInput[];
  readonly nudgeOverlays?: readonly PromptContributionInput[];
  readonly messages: readonly RuntimeMessageSnapshot[];
  readonly messageHighWatermark: number;
}

export interface PromptAssemblyBuilderOptions {
  readonly digester: PromptDigester;
  readonly messageSchemaRegistry?: RuntimeMessageSchemaRegistry;
  readonly logger?: Logger;
}

export class PromptAssemblyBuilder {
  readonly #digester: PromptDigester;
  readonly #messageSchemaRegistry: RuntimeMessageSchemaRegistry;
  readonly #logger: Logger;

  constructor(options: PromptAssemblyBuilderOptions) {
    this.#digester = options.digester;
    this.#messageSchemaRegistry = options.messageSchemaRegistry ??
      coreRuntimeMessageSchemaRegistry;
    this.#logger = (options.logger ?? noopLogger).child({
      component: "prompt_assembly_builder",
    });
  }

  async build(request: PromptAssemblyBuildRequest): Promise<PromptAssembly> {
    const identity = captureIdentity(request);
    this.#logger.debug("prompt.assembly_started", {
      ...identity,
      messageCount: Array.isArray(request.messages) ? request.messages.length : 0,
      checkpointOverlayCount: request.checkpointOverlays?.length ?? 0,
      nudgeOverlayCount: request.nudgeOverlays?.length ?? 0,
    });
    try {
      if (!request.basePrompt) {
        throw this.failure(PROMPT_ASSEMBLY_FAILURE.invalidRequest, identity);
      }
      assertHighWatermark(request.messageHighWatermark, identity);
      const overlays = [
        ...(await captureContributions(
          request.checkpointOverlays ?? [],
          identity,
          this.#digester,
        )),
        ...(await captureContributions(
          request.nudgeOverlays ?? [],
          identity,
          this.#digester,
        )),
      ].sort(compareContributions);
      assertUniqueContributions(overlays, identity);
      const messages = captureMessages(
        request.messages,
        identity,
        this.#messageSchemaRegistry,
      );
      const systemPrompt = [
        request.basePrompt.content,
        ...overlays.map((overlay) => overlay.content),
      ].join("\n\n");
      const digest = await this.#digester.digest(
        canonicalStringifyJson({
          conversationId: identity.conversationId,
          runId: identity.runId,
          basePromptDigest: request.basePrompt.digest,
          overlays: overlays.map((overlay) => overlay.toSnapshot()),
          messageIds: messages.map((message) => message.id),
          messageHighWatermark: request.messageHighWatermark,
          systemPrompt,
        } as unknown as JsonValue),
      );
      const assembly = new PromptAssembly({
        conversationId: identity.conversationId,
        runId: identity.runId,
        basePrompt: request.basePrompt,
        overlays,
        messages,
        messageHighWatermark: request.messageHighWatermark,
        systemPrompt,
        digest,
      });
      this.#logger.info("prompt.assembly_completed", {
        ...identity,
        overlayCount: assembly.overlays.length,
        messageCount: assembly.messages.length,
        assemblyDigest: assembly.digest,
      });
      return assembly;
    } catch (error) {
      const normalized = error instanceof PromptAssemblyError
        ? error
        : this.failure(PROMPT_ASSEMBLY_FAILURE.invalidRequest, identity);
      this.#logger.error("prompt.assembly_failed", {
        ...identity,
        failure: normalized.failure,
      });
      throw normalized;
    }
  }

  private failure(
    failure: (typeof PROMPT_ASSEMBLY_FAILURE)[keyof typeof PROMPT_ASSEMBLY_FAILURE],
    identity: PromptAssemblyIdentity,
  ): PromptAssemblyError {
    return new PromptAssemblyError(failure, identity.conversationId, identity.runId);
  }
}

function captureIdentity(request: PromptAssemblyBuildRequest): PromptAssemblyIdentity {
  if (
    typeof request?.conversationId !== "string" ||
    request.conversationId.trim().length === 0 ||
    typeof request?.runId !== "string" ||
    request.runId.trim().length === 0
  ) {
    throw new PromptAssemblyError(PROMPT_ASSEMBLY_FAILURE.invalidRequest);
  }
  return Object.freeze({
    conversationId: request.conversationId,
    runId: request.runId,
  });
}

function assertHighWatermark(
  value: unknown,
  identity: PromptAssemblyIdentity,
): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new PromptAssemblyError(
      PROMPT_ASSEMBLY_FAILURE.invalidHighWatermark,
      identity.conversationId,
      identity.runId,
    );
  }
}

async function captureContributions(
  inputs: readonly PromptContributionInput[],
  identity: PromptAssemblyIdentity,
  digester: PromptDigester,
): Promise<readonly PromptContribution[]> {
  if (!Array.isArray(inputs)) {
    throw new PromptAssemblyError(
      PROMPT_ASSEMBLY_FAILURE.invalidContribution,
      identity.conversationId,
      identity.runId,
    );
  }
  return Promise.all(inputs.map(async (input) => {
    if (
      (input.layer === "checkpoint" && input.kind !== "checkpoint") ||
      (input.layer === "nudge" && input.kind !== "nudge")
    ) {
      throw new PromptAssemblyError(
        PROMPT_ASSEMBLY_FAILURE.invalidContribution,
        identity.conversationId,
        identity.runId,
      );
    }
    const digest = await digester.digest(input.content);
    return new PromptContribution({
      ...input,
      digest,
    });
  }));
}

function assertUniqueContributions(
  contributions: readonly PromptContribution[],
  identity: PromptAssemblyIdentity,
): void {
  const seen = new Set<string>();
  for (const contribution of contributions) {
    const key = `${contribution.layer}:${contribution.sourceId}`;
    if (seen.has(key)) {
      throw new PromptAssemblyError(
        PROMPT_ASSEMBLY_FAILURE.duplicateContribution,
        identity.conversationId,
        identity.runId,
      );
    }
    seen.add(key);
  }
}

function captureMessages(
  messages: readonly RuntimeMessageSnapshot[],
  identity: PromptAssemblyIdentity,
  registry: RuntimeMessageSchemaRegistry,
): readonly RuntimeMessageSnapshot[] {
  if (!Array.isArray(messages)) {
    throw new PromptAssemblyError(
      PROMPT_ASSEMBLY_FAILURE.invalidMessage,
      identity.conversationId,
      identity.runId,
    );
  }
  const seen = new Set<string>();
  return Object.freeze(messages.map((message) => {
    let captured: RuntimeMessageSnapshot;
    try {
      captured = registry.validateSnapshot(message);
    } catch {
      throw new PromptAssemblyError(
        PROMPT_ASSEMBLY_FAILURE.invalidMessage,
        identity.conversationId,
        identity.runId,
      );
    }
    if (captured.conversationId !== identity.conversationId) {
      throw new PromptAssemblyError(
        PROMPT_ASSEMBLY_FAILURE.conversationMismatch,
        identity.conversationId,
        identity.runId,
      );
    }
    if (seen.has(captured.id)) {
      throw new PromptAssemblyError(
        PROMPT_ASSEMBLY_FAILURE.duplicateMessage,
        identity.conversationId,
        identity.runId,
      );
    }
    seen.add(captured.id);
    return deepFreeze(JSON.parse(JSON.stringify(captured)) as RuntimeMessageSnapshot);
  }));
}

function compareContributions(
  left: PromptContribution,
  right: PromptContribution,
): number {
  const layerDifference = layerOrder(left.layer) - layerOrder(right.layer);
  if (layerDifference !== 0) return layerDifference;
  if (left.order !== right.order) return left.order - right.order;
  return left.sourceId.localeCompare(right.sourceId);
}

function layerOrder(layer: PromptContribution["layer"]): number {
  return layer === "base" ? 0 : layer === "checkpoint" ? 1 : 2;
}

interface PromptAssemblyIdentity {
  readonly conversationId: string;
  readonly runId: string;
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
  return value;
}
