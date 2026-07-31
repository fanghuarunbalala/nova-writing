import { EventPayload } from "./payload/EventPayload.js";
import type { InputEventSnapshot } from "./InputEventSnapshot.js";
import { generateEventId } from "../generateEventId.js";
import { EVENT_SCHEMA_VERSION } from "../protocol/EventMetadata.js";
import { InputRejectedError } from "./InputRejectedError.js";
import type { InputEventOptions } from "./InputEventOptions.js";

export abstract class InputEvent {
  public readonly id: string;
  public readonly conversationId?: string;
  public readonly timestamp: string;
  public readonly correlationId?: string;
  public readonly causationId?: string;
  public readonly runId?: string;
  public readonly turnId?: string;

  protected constructor(options: InputEventOptions = {}) {
    this.id = options.id ?? generateEventId();
    this.conversationId = options.conversationId;
    this.timestamp = options.timestamp ?? new Date().toISOString();
    this.correlationId = options.correlationId;
    this.causationId = options.causationId;
    this.runId = options.runId;
    this.turnId = options.turnId;
  }

  abstract getEventType(): string;

  abstract getPriority(): number;

  getTimestamp(): string {
    return this.timestamp;
  }

  abstract getPayload(): EventPayload;

  getSnapshot(defaultConversationId?: string): InputEventSnapshot {
    const conversationId = this.resolveConversationId(defaultConversationId);
    return {
      id: this.id,
      conversationId,
      eventType: this.getEventType(),
      schemaVersion: EVENT_SCHEMA_VERSION,
      priority: this.getPriority(),
      timestamp: this.getTimestamp(),
      ...(this.correlationId !== undefined ? { correlationId: this.correlationId } : {}),
      ...(this.causationId !== undefined ? { causationId: this.causationId } : {}),
      ...(this.runId !== undefined ? { runId: this.runId } : {}),
      ...(this.turnId !== undefined ? { turnId: this.turnId } : {}),
      payload: this.getPayload().toObject(),
    };
  }

  toJSON(): InputEventSnapshot {
    return this.getSnapshot();
  }

  private resolveConversationId(defaultConversationId?: string): string {
    if (this.conversationId && defaultConversationId && this.conversationId !== defaultConversationId) {
      throw new InputRejectedError(
        "conversation_id_mismatch",
        `Input event ${this.id} targets ${this.conversationId}, not ${defaultConversationId}`,
      );
    }

    const conversationId = this.conversationId ?? defaultConversationId;
    if (!conversationId) {
      throw new InputRejectedError(
        "conversation_id_required",
        `Input event ${this.id} must be bound to a conversation before serialization`,
      );
    }
    return conversationId;
  }
}
