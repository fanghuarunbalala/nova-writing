/**
 * 一次 provider 调用候选（base + 消息）的确定性组装器。
 * Deterministically assembles one provider-call candidate from the Base Prompt
 * and canonical Messages.
 *
 * 动态内容（todo / nudge / plan 约束 / deferred 名单）以 system.reminder 消息
 * 进入 messages，不再拼接进 system prompt；systemPrompt 恒等于 basePrompt.content，
 * 保持 base 稳定可缓存，不破坏 provider prefill 缓存。
 * Dynamic content (todos, nudges, plan constraints, deferred-tool lists) arrives
 * as system.reminder messages inside `messages`; the system prompt always equals
 * the base content so it stays stable and provider prefill caches stay valid.
 */
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
import type { PromptBase, PromptDigester } from "../PromptDigester.js";
import {
  PromptAssembly,
} from "./PromptAssembly.js";
import {
  PROMPT_ASSEMBLY_FAILURE,
  PromptAssemblyError,
} from "./PromptAssemblyErrors.js";
import {
  appendEnvironmentOverlay,
  type EnvironmentInfoProvider,
} from "../environment/index.js";

export interface PromptAssemblyBuildRequest {
  readonly conversationId: string;
  readonly runId: string;
  readonly basePrompt: PromptBase;
  readonly messages: readonly RuntimeMessageSnapshot[];
  readonly messageHighWatermark: number;
}

export interface PromptAssemblyBuilderOptions {
  readonly digester: PromptDigester;
  readonly messageSchemaRegistry?: RuntimeMessageSchemaRegistry;
  /**
   * 可选环境信息提供者：存在时每次 build 把环境块刷新进 systemPrompt。
   * Optional environment info provider: when present, each build refreshes the
   * environment block into the systemPrompt.
   */
  readonly environmentInfo?: EnvironmentInfoProvider;
  readonly logger?: Logger;
}

export class PromptAssemblyBuilder {
  readonly #digester: PromptDigester;
  readonly #messageSchemaRegistry: RuntimeMessageSchemaRegistry;
  readonly #environmentInfo?: EnvironmentInfoProvider;
  readonly #logger: Logger;

  constructor(options: PromptAssemblyBuilderOptions) {
    this.#digester = options.digester;
    this.#messageSchemaRegistry = options.messageSchemaRegistry ??
      coreRuntimeMessageSchemaRegistry;
    this.#environmentInfo = options.environmentInfo;
    this.#logger = (options.logger ?? noopLogger).child({
      component: "prompt_assembly_builder",
    });
  }

  async build(request: PromptAssemblyBuildRequest): Promise<PromptAssembly> {
    const identity = captureIdentity(request);
    this.#logger.debug("prompt.assembly_started", {
      ...identity,
      messageCount: Array.isArray(request.messages) ? request.messages.length : 0,
    });
    try {
      if (!request.basePrompt) {
        throw this.failure(PROMPT_ASSEMBLY_FAILURE.invalidRequest, identity);
      }
      assertHighWatermark(request.messageHighWatermark, identity);
      const messages = captureMessages(
        request.messages,
        identity,
        this.#messageSchemaRegistry,
      );
      const systemPrompt = await this.#resolveSystemPrompt(
        request.basePrompt.content,
      );
      const digest = await this.#digester.digest(
        canonicalStringifyJson({
          conversationId: identity.conversationId,
          runId: identity.runId,
          basePromptDigest: request.basePrompt.digest,
          messages: messages.map((message) => ({
            id: message.id,
            role: message.role,
            messageType: message.messageType,
            payload: message.payload,
          })),
          messageHighWatermark: request.messageHighWatermark,
          systemPrompt,
        } as unknown as JsonValue),
      );
      const assembly = new PromptAssembly({
        conversationId: identity.conversationId,
        runId: identity.runId,
        basePrompt: request.basePrompt,
        messages,
        messageHighWatermark: request.messageHighWatermark,
        systemPrompt,
        digest,
      });
      this.#logger.info("prompt.assembly_completed", {
        ...identity,
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

  /** 解析最终 systemPrompt：base + 可选环境块（每轮刷新）。Resolves the final systemPrompt: base plus the optional per-call environment block. */
  async #resolveSystemPrompt(base: string): Promise<string> {
    if (this.#environmentInfo === undefined) {
      return base;
    }
    const snapshot = await this.#environmentInfo.snapshot();
    return appendEnvironmentOverlay(base, snapshot);
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
