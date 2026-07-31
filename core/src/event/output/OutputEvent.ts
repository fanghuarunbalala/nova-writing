import { generateEventId } from "../generateEventId.js";
import { EVENT_SCHEMA_VERSION } from "../protocol/EventMetadata.js";
import type { OutputPayload } from "./OutputPayload.js";
import type { OutputEventSnapshot } from "./OutputEventSnapshot.js";
import type { OutputEventOptions } from "./OutputEventOptions.js";

export abstract class OutputEvent {
  public readonly conversationId: string;
  public readonly id: string;
  public readonly timestamp: string;
  public readonly correlationId?: string;
  public readonly causationId?: string;
  public readonly runId?: string;
  public readonly turnId?: string;

  protected constructor(options: OutputEventOptions) {
    this.conversationId = options.conversationId;
    this.id = options.id ?? generateEventId();
    this.timestamp = options.timestamp ?? new Date().toISOString();
    this.correlationId = options.correlationId;
    this.causationId = options.causationId;
    this.runId = options.runId;
    this.turnId = options.turnId;
  }

  abstract getEventType(): string;

  abstract getPayload(): OutputPayload;

  getSnapshot(): OutputEventSnapshot {
    return {
      id: this.id,
      conversationId: this.conversationId,
      eventType: this.getEventType(),
      schemaVersion: EVENT_SCHEMA_VERSION,
      timestamp: this.timestamp,
      ...(this.correlationId !== undefined ? { correlationId: this.correlationId } : {}),
      ...(this.causationId !== undefined ? { causationId: this.causationId } : {}),
      ...(this.runId !== undefined ? { runId: this.runId } : {}),
      ...(this.turnId !== undefined ? { turnId: this.turnId } : {}),
      payload: this.getPayload().toObject(),
    };
  }

  toJSON(): OutputEventSnapshot {
    return this.getSnapshot();
  }
}
