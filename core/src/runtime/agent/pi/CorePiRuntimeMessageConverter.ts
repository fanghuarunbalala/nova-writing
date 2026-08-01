/** Converts registered Core Runtime Messages into private Pi Agent messages. */
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { noopLogger, type Logger } from "../../../observability/index.js";
import {
  CORE_RUNTIME_MESSAGE_TYPE,
  RUNTIME_MESSAGE_SCHEMA_VERSION,
  coreRuntimeMessageSchemaRegistry,
  type RuntimeMessageSchemaRegistry,
  type RuntimeMessageSnapshot,
} from "../../message/index.js";
import {
  CORE_PI_MESSAGE_CONVERSION_FAILURE,
  CorePiRuntimeMessageConversionError,
  type CorePiMessageConversionFailure,
} from "./CorePiRuntimeMessageConverterErrors.js";
import {
  PI_RUNTIME_MESSAGE_CONVERSION_PURPOSE,
  type PiRuntimeMessageConversionRequest,
  type PiRuntimeMessageConverter,
} from "./PiRuntimeMessageConverter.js";
import type {
  PiAssistantMessageEnvelope,
  PiAssistantMessageEnvelopeFactory,
} from "./PiAssistantMessageEnvelopeFactory.js";

export interface CorePiRuntimeMessageConverterOptions {
  messageSchemaRegistry?: RuntimeMessageSchemaRegistry;
  assistantMessageEnvelopeFactory?: PiAssistantMessageEnvelopeFactory;
  logger?: Logger;
}

interface CoreUserMessagePayload {
  readonly content: readonly {
    readonly type: "text";
    readonly text: string;
  }[];
}

interface CoreAssistantMessagePayload {
  readonly content: readonly {
    readonly type: "text";
    readonly text: string;
  }[];
}

export class CorePiRuntimeMessageConverter implements PiRuntimeMessageConverter {
  private readonly messageSchemaRegistry: RuntimeMessageSchemaRegistry;
  private readonly assistantMessageEnvelopeFactory?: PiAssistantMessageEnvelopeFactory;
  private readonly logger: Logger;

  constructor(options: CorePiRuntimeMessageConverterOptions = {}) {
    this.messageSchemaRegistry =
      options.messageSchemaRegistry ?? coreRuntimeMessageSchemaRegistry;
    this.assistantMessageEnvelopeFactory = options.assistantMessageEnvelopeFactory;
    this.logger = (options.logger ?? noopLogger).child({
      component: "core_pi_runtime_message_converter",
    });
  }

  async convert(
    request: PiRuntimeMessageConversionRequest,
  ): Promise<readonly AgentMessage[]> {
    const identity = captureRequestIdentity(request);
    if (
      identity === undefined ||
      !Object.values(PI_RUNTIME_MESSAGE_CONVERSION_PURPOSE).includes(request?.purpose) ||
      !Array.isArray(request?.messages)
    ) {
      throw this.fail(
        CORE_PI_MESSAGE_CONVERSION_FAILURE.invalidRequest,
        identity?.conversationId,
        identity?.runId,
      );
    }

    this.logger.debug("runtime.agent.message_conversion_started", {
      ...identity,
      purpose: request.purpose,
      messageCount: request.messages.length,
    });
    const seenIds = new Set<string>();
    const converted = request.messages.map((message) => {
      let validated: RuntimeMessageSnapshot;
      try {
        validated = this.messageSchemaRegistry.validateSnapshot(message);
      } catch {
        throw this.fail(
          CORE_PI_MESSAGE_CONVERSION_FAILURE.invalidMessage,
          identity.conversationId,
          identity.runId,
        );
      }
      if (validated.conversationId !== identity.conversationId) {
        throw this.fail(
          CORE_PI_MESSAGE_CONVERSION_FAILURE.invalidMessage,
          identity.conversationId,
          identity.runId,
        );
      }
      if (seenIds.has(validated.id)) {
        throw this.fail(
          CORE_PI_MESSAGE_CONVERSION_FAILURE.duplicateMessage,
          identity.conversationId,
          identity.runId,
        );
      }
      seenIds.add(validated.id);
      return this.convertMessage(validated, identity);
    });
    const result = Object.freeze(converted);
    this.logger.info("runtime.agent.message_conversion_completed", {
      ...identity,
      purpose: request.purpose,
      messageCount: result.length,
    });
    return result;
  }

  private convertMessage(
    message: RuntimeMessageSnapshot,
    identity: RuntimeIdentity,
  ): AgentMessage {
    if (
      message.role === "user" &&
      message.messageType === CORE_RUNTIME_MESSAGE_TYPE.userMessage &&
      message.schemaVersion === RUNTIME_MESSAGE_SCHEMA_VERSION
    ) {
      return this.convertUserMessage(message);
    }
    if (
      message.role === "assistant" &&
      message.messageType === CORE_RUNTIME_MESSAGE_TYPE.assistantMessage &&
      message.schemaVersion === RUNTIME_MESSAGE_SCHEMA_VERSION
    ) {
      return this.convertAssistantMessage(message, identity);
    }
    throw this.fail(
      CORE_PI_MESSAGE_CONVERSION_FAILURE.unsupportedMessage,
      identity.conversationId,
      identity.runId,
    );
  }

  private convertUserMessage(message: RuntimeMessageSnapshot): AgentMessage {
    const payload = message.payload as unknown as CoreUserMessagePayload;
    const content = payload.content.map((item) =>
      Object.freeze({ type: item.type, text: item.text }),
    );
    Object.freeze(content);
    return Object.freeze({
      role: "user",
      content,
      timestamp: Date.parse(message.timestamp),
    });
  }

  private convertAssistantMessage(
    message: RuntimeMessageSnapshot,
    identity: RuntimeIdentity,
  ): AgentMessage {
    if (this.assistantMessageEnvelopeFactory === undefined) {
      throw this.fail(
        CORE_PI_MESSAGE_CONVERSION_FAILURE.assistantEnvelopeUnavailable,
        identity.conversationId,
        identity.runId,
      );
    }

    let envelope: PiAssistantMessageEnvelope;
    try {
      envelope = captureAssistantEnvelope(
        this.assistantMessageEnvelopeFactory.create(),
      );
    } catch {
      throw this.fail(
        CORE_PI_MESSAGE_CONVERSION_FAILURE.assistantEnvelopeInvalid,
        identity.conversationId,
        identity.runId,
      );
    }

    const payload = message.payload as unknown as CoreAssistantMessagePayload;
    const content = payload.content.map((item) =>
      Object.freeze({ type: item.type, text: item.text }),
    );
    Object.freeze(content);
    return Object.freeze({
      role: "assistant",
      content,
      api: envelope.api,
      provider: envelope.provider,
      model: envelope.model,
      usage: createEmptyUsage(),
      stopReason: "stop",
      timestamp: Date.parse(message.timestamp),
    });
  }

  private fail(
    failure: CorePiMessageConversionFailure,
    conversationId?: string,
    runId?: string,
  ): CorePiRuntimeMessageConversionError {
    this.logger.error("runtime.agent.message_conversion_failed", {
      failure,
      ...(conversationId !== undefined ? { conversationId } : {}),
      ...(runId !== undefined ? { runId } : {}),
    });
    return new CorePiRuntimeMessageConversionError(
      failure,
      conversationId,
      runId,
    );
  }
}

interface RuntimeIdentity {
  readonly conversationId: string;
  readonly runId: string;
}

function captureRequestIdentity(
  request: PiRuntimeMessageConversionRequest,
): RuntimeIdentity | undefined {
  const conversationId = captureNonBlank(request?.conversationId);
  const runId = captureNonBlank(request?.runId);
  return conversationId === undefined || runId === undefined
    ? undefined
    : Object.freeze({ conversationId, runId });
}

function captureNonBlank(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function captureAssistantEnvelope(value: unknown): PiAssistantMessageEnvelope {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Pi Assistant envelope is invalid");
  }
  const envelope = value as Record<string, unknown>;
  const api = captureNonBlank(envelope.api);
  const provider = captureNonBlank(envelope.provider);
  const model = captureNonBlank(envelope.model);
  if (api === undefined || provider === undefined || model === undefined) {
    throw new TypeError("Pi Assistant envelope is invalid");
  }
  return Object.freeze({ api, provider, model });
}

function createEmptyUsage() {
  return Object.freeze({
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: Object.freeze({
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    }),
  });
}
