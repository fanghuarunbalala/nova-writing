/** Bridges one validated Novel lifecycle Record into a retry-stable OutputEvent. */
import { NovelOutputEvent, OutputPayload, type JsonObject } from "../../event/index.js";
import {
  NOVEL_LIFECYCLE_RECORD_VERSION,
  captureNovelLifecycleRecord,
  type NovelLifecycleEventType,
  type NovelLifecyclePayloads,
  type NovelLifecycleRecord,
} from "../event/index.js";

export class NovelLifecycleOutputPayload<
  T extends NovelLifecycleEventType,
> extends OutputPayload {
  constructor(
    readonly novelId: NovelLifecycleRecord<T>["novelId"],
    readonly lifecyclePayload: NovelLifecyclePayloads[T],
  ) {
    super();
  }

  toObject(): JsonObject {
    return {
      lifecycleVersion: NOVEL_LIFECYCLE_RECORD_VERSION,
      novelId: this.novelId,
      ...(this.lifecyclePayload as unknown as JsonObject),
    };
  }
}

export class NovelLifecycleOutputEvent<
  T extends NovelLifecycleEventType = NovelLifecycleEventType,
> extends NovelOutputEvent {
  readonly record: NovelLifecycleRecord<T>;

  constructor(recordInput: NovelLifecycleRecord<T>) {
    const record = captureNovelLifecycleRecord(recordInput);
    super(
      record.eventType,
      new NovelLifecycleOutputPayload(record.novelId, record.payload),
      {
        id: record.eventId,
        conversationId: record.conversationId,
        timestamp: record.occurredAt,
      },
    );
    this.record = record;
  }
}
