/** Journal-backed Runtime Input resolver with strict durable identity validation. */
import type { ConversationRuntimeInputReference } from "../../../conversation/host/ConversationRuntimeInputReference.js";
import {
  canonicalStringifyJson,
  isEventType,
  type EventSchemaRegistry,
  type InputEventSnapshot,
  type JsonValue,
} from "../../../event/index.js";
import { noopLogger, type Logger } from "../../../observability/index.js";
import type { ConversationJournalReader } from "../../../storage/journal/ConversationJournalStore.js";
import type { PersistedInputEventSnapshot } from "../../../storage/journal/PersistedConversationEventSnapshot.js";
import {
  RUNTIME_INPUT_RESOLUTION_FAILURE,
  RuntimeInputResolutionError,
  type RuntimeInputResolutionFailure,
} from "./RuntimeInputResolutionError.js";
import type { RuntimeInputResolver } from "./RuntimeInputResolver.js";

export interface JournalRuntimeInputResolverOptions {
  journal: ConversationJournalReader;
  eventSchemaRegistry: EventSchemaRegistry;
  logger?: Logger;
}

export class JournalRuntimeInputResolver implements RuntimeInputResolver {
  private readonly journal: ConversationJournalReader;
  private readonly eventSchemaRegistry: EventSchemaRegistry;
  private readonly logger: Logger;

  constructor(options: JournalRuntimeInputResolverOptions) {
    this.journal = options.journal;
    this.eventSchemaRegistry = options.eventSchemaRegistry;
    this.logger = (options.logger ?? noopLogger).child({
      component: "journal_runtime_input_resolver",
    });
  }

  async resolve(
    reference: ConversationRuntimeInputReference,
  ): Promise<PersistedInputEventSnapshot> {
    let capturedReference: CapturedReference;
    try {
      capturedReference = captureReference(reference);
    } catch (error) {
      if (error instanceof RuntimeInputResolutionError) {
        this.logger.error("runtime.input.resolve_failed", {
          conversationId: error.conversationId,
          sequence: error.sequence,
          failure: error.failure,
        });
      }
      throw error;
    }
    const identity = toReferenceIdentity(capturedReference);
    this.logger.debug("runtime.input.resolve_started", { ...identity });

    let event;
    try {
      event = await this.journal.getBySequence(identity.conversationId, identity.sequence);
    } catch {
      throw this.fail(identity, RUNTIME_INPUT_RESOLUTION_FAILURE.readFailed);
    }
    if (event === undefined) {
      throw this.fail(identity, RUNTIME_INPUT_RESOLUTION_FAILURE.notFound);
    }
    if (event.direction !== "input") {
      throw this.fail(identity, RUNTIME_INPUT_RESOLUTION_FAILURE.directionMismatch);
    }
    if (!matchesReference(event, capturedReference)) {
      throw this.fail(identity, RUNTIME_INPUT_RESOLUTION_FAILURE.identityMismatch);
    }

    try {
      this.eventSchemaRegistry.validateInput(toInputSnapshot(event));
      const captured = deepFreezeJson(
        JSON.parse(canonicalStringifyJson(event as unknown as JsonValue)),
      ) as PersistedInputEventSnapshot;
      this.logger.info("runtime.input.resolved", {
        ...identity,
        eventId: captured.id,
        eventType: captured.eventType,
        priority: captured.priority,
      });
      return captured;
    } catch {
      throw this.fail(identity, RUNTIME_INPUT_RESOLUTION_FAILURE.invalidEvent);
    }
  }

  private fail(
    identity: ReferenceIdentity,
    failure: RuntimeInputResolutionFailure,
  ): RuntimeInputResolutionError {
    this.logger.error("runtime.input.resolve_failed", {
      ...identity,
      failure,
    });
    return new RuntimeInputResolutionError(
      identity.conversationId,
      identity.sequence,
      failure,
    );
  }
}

interface CapturedReference extends ReferenceIdentity {
  correlationId?: string;
  runId?: string;
  turnId?: string;
}

interface ReferenceIdentity {
  conversationId: string;
  sequence: number;
  inputEventId: string;
  eventType: string;
}

function captureReference(reference: ConversationRuntimeInputReference): CapturedReference {
  if (
    reference === null ||
    typeof reference !== "object" ||
    typeof reference.conversationId !== "string" ||
    reference.conversationId.trim().length === 0 ||
    typeof reference.inputEventId !== "string" ||
    reference.inputEventId.trim().length === 0 ||
    typeof reference.eventType !== "string" ||
    !isEventType(reference.eventType) ||
    !Number.isSafeInteger(reference.sequence) ||
    reference.sequence <= 0 ||
    !isOptionalIdentifier(reference.correlationId) ||
    !isOptionalIdentifier(reference.runId) ||
    !isOptionalIdentifier(reference.turnId)
  ) {
    throw new RuntimeInputResolutionError(
      safeIdentifier(reference?.conversationId),
      Number.isSafeInteger(reference?.sequence) ? reference.sequence : 0,
      RUNTIME_INPUT_RESOLUTION_FAILURE.invalidReference,
    );
  }
  return Object.freeze({
    conversationId: reference.conversationId,
    sequence: reference.sequence,
    inputEventId: reference.inputEventId,
    eventType: reference.eventType,
    ...(reference.correlationId !== undefined
      ? { correlationId: reference.correlationId }
      : {}),
    ...(reference.runId !== undefined ? { runId: reference.runId } : {}),
    ...(reference.turnId !== undefined ? { turnId: reference.turnId } : {}),
  });
}

function toReferenceIdentity(reference: CapturedReference): ReferenceIdentity {
  return Object.freeze({
    conversationId: reference.conversationId,
    sequence: reference.sequence,
    inputEventId: reference.inputEventId,
    eventType: reference.eventType,
  });
}

function matchesReference(
  event: PersistedInputEventSnapshot,
  reference: ConversationRuntimeInputReference,
): boolean {
  return (
    event.conversationId === reference.conversationId &&
    event.id === reference.inputEventId &&
    event.eventType === reference.eventType &&
    matchesOptional(reference.correlationId, event.correlationId) &&
    matchesOptional(reference.runId, event.runId) &&
    matchesOptional(reference.turnId, event.turnId)
  );
}

function matchesOptional(expected: string | undefined, actual: string | undefined): boolean {
  return expected === undefined || expected === actual;
}

function isOptionalIdentifier(value: unknown): value is string | undefined {
  return value === undefined || (typeof value === "string" && value.trim().length > 0);
}

function toInputSnapshot(event: PersistedInputEventSnapshot): InputEventSnapshot {
  return {
    id: event.id,
    conversationId: event.conversationId,
    eventType: event.eventType,
    schemaVersion: event.schemaVersion,
    priority: event.priority,
    timestamp: event.timestamp,
    ...(event.correlationId !== undefined ? { correlationId: event.correlationId } : {}),
    ...(event.causationId !== undefined ? { causationId: event.causationId } : {}),
    ...(event.runId !== undefined ? { runId: event.runId } : {}),
    ...(event.turnId !== undefined ? { turnId: event.turnId } : {}),
    payload: event.payload,
  };
}

function deepFreezeJson<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  for (const child of Object.values(value)) deepFreezeJson(child);
  return Object.freeze(value);
}

function safeIdentifier(value: unknown): string {
  return typeof value === "string" && value.trim().length > 0 ? value : "unknown";
}
