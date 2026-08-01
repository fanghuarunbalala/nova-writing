/**
 * Validates and snapshots canonical Runtime Messages for one Agent Run.
 *
 * This base compiler intentionally performs no Prompt layering, compaction,
 * Nudge injection, Tool projection, or Provider-specific conversion.
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
} from "../message/index.js";
import type {
  CompiledProviderContext,
  ContextCompileRequest,
  ContextCompiler,
} from "./ContextCompiler.js";
import {
  CONTEXT_COMPILE_FAILURE,
  ContextCompileError,
  type ContextCompileFailure,
} from "./ContextCompilerErrors.js";

export interface BaseContextCompilerOptions {
  messageSchemaRegistry?: RuntimeMessageSchemaRegistry;
  logger?: Logger;
}

export class BaseContextCompiler implements ContextCompiler {
  private readonly messageSchemaRegistry: RuntimeMessageSchemaRegistry;
  private readonly logger: Logger;

  constructor(options: BaseContextCompilerOptions = {}) {
    this.messageSchemaRegistry =
      options.messageSchemaRegistry ?? coreRuntimeMessageSchemaRegistry;
    this.logger = (options.logger ?? noopLogger).child({
      component: "base_context_compiler",
    });
  }

  async compile(request: ContextCompileRequest): Promise<CompiledProviderContext> {
    const identity = captureIdentity(request);
    this.logger.debug("runtime.context.compile_started", {
      ...identity,
      messageCount: Array.isArray(request.messages) ? request.messages.length : 0,
    });

    try {
      if (typeof request.systemPrompt !== "string" || !Array.isArray(request.messages)) {
        throw this.failure(CONTEXT_COMPILE_FAILURE.invalidRequest, identity);
      }

      const messages = this.captureMessages(request.messages, identity);
      const compiled = Object.freeze({
        ...identity,
        systemPrompt: request.systemPrompt,
        messages,
      });
      this.logger.info("runtime.context.compile_completed", {
        ...identity,
        messageCount: messages.length,
      });
      return compiled;
    } catch (error) {
      if (error instanceof ContextCompileError) throw error;
      throw this.failure(CONTEXT_COMPILE_FAILURE.invalidMessage, identity);
    }
  }

  private captureMessages(
    messages: readonly RuntimeMessageSnapshot[],
    identity: RuntimeContextIdentity,
  ): readonly RuntimeMessageSnapshot[] {
    const messageIds = new Set<string>();
    const captured = messages.map((message) => {
      let validated: RuntimeMessageSnapshot;
      try {
        validated = this.messageSchemaRegistry.validateSnapshot(message);
      } catch {
        throw this.failure(CONTEXT_COMPILE_FAILURE.invalidMessage, identity);
      }
      if (validated.conversationId !== identity.conversationId) {
        throw this.failure(CONTEXT_COMPILE_FAILURE.conversationMismatch, identity);
      }
      if (messageIds.has(validated.id)) {
        throw this.failure(CONTEXT_COMPILE_FAILURE.duplicateMessage, identity);
      }
      messageIds.add(validated.id);
      return freezeJsonClone(validated);
    });
    return Object.freeze(captured);
  }

  private failure(
    failure: ContextCompileFailure,
    identity: RuntimeContextIdentity,
  ): ContextCompileError {
    this.logger.error("runtime.context.compile_failed", {
      ...identity,
      failure,
    });
    return new ContextCompileError(
      failure,
      identity.conversationId,
      identity.runId,
    );
  }
}

interface RuntimeContextIdentity {
  readonly conversationId: string;
  readonly runId: string;
}

function captureIdentity(request: ContextCompileRequest): RuntimeContextIdentity {
  const conversationId = captureNonBlank(request?.conversationId);
  const runId = captureNonBlank(request?.runId);
  if (conversationId === undefined || runId === undefined) {
    throw new ContextCompileError(
      CONTEXT_COMPILE_FAILURE.invalidRequest,
      conversationId,
      runId,
    );
  }
  return Object.freeze({ conversationId, runId });
}

function captureNonBlank(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function freezeJsonClone(message: RuntimeMessageSnapshot): RuntimeMessageSnapshot {
  const clone = JSON.parse(
    canonicalStringifyJson(message as unknown as JsonValue),
  ) as RuntimeMessageSnapshot;
  return deepFreeze(clone);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}
