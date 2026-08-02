/** Publishes one lifecycle Record through a durable Conversation Output boundary. */
import type { NovelLifecycleRecord } from "../event/index.js";
import type { NovelTimestamp } from "../version/index.js";

export const NOVEL_LIFECYCLE_PUBLICATION_STATUS = {
  recorded: "recorded",
  duplicate: "duplicate",
} as const;

export type NovelLifecyclePublicationStatus =
  (typeof NOVEL_LIFECYCLE_PUBLICATION_STATUS)[keyof typeof NOVEL_LIFECYCLE_PUBLICATION_STATUS];

export interface NovelLifecyclePublicationReceipt {
  readonly status: NovelLifecyclePublicationStatus;
  readonly conversationId: string;
  readonly eventId: string;
  readonly sequence: number;
  readonly recordedAt: NovelTimestamp;
}

export interface NovelLifecycleOutputPublisher {
  publish(
    record: NovelLifecycleRecord,
  ): Promise<NovelLifecyclePublicationReceipt>;
}
