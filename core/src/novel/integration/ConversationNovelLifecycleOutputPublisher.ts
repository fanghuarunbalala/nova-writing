/** Converts lifecycle Records to retry-stable OutputEvents and validates Journal receipts. */
import {
  OUTPUT_RECEIPT_STATUS,
  type ConversationOutputEventPublisher,
  type OutputReceipt,
} from "../../conversation/index.js";
import {
  captureNovelLifecycleRecord,
  type NovelLifecycleRecord,
} from "../event/index.js";
import {
  NOVEL_OUTBOX_DISPATCH_FAILURE,
  NovelOutboxDispatchError,
} from "../error/index.js";
import {
  NOVEL_LIFECYCLE_PUBLICATION_STATUS,
  type NovelLifecycleOutputPublisher,
  type NovelLifecyclePublicationReceipt,
} from "../port/index.js";
import { captureNovelTimestamp } from "../version/index.js";
import { NovelLifecycleOutputEvent } from "./NovelLifecycleOutputEvent.js";

export class ConversationNovelLifecycleOutputPublisher
  implements NovelLifecycleOutputPublisher
{
  constructor(
    private readonly outputPublisher: ConversationOutputEventPublisher,
  ) {}

  async publish(
    recordInput: NovelLifecycleRecord,
  ): Promise<NovelLifecyclePublicationReceipt> {
    const record = captureNovelLifecycleRecord(recordInput);
    let receipt: OutputReceipt;
    try {
      receipt = await this.outputPublisher.publish(
        new NovelLifecycleOutputEvent(record),
      );
    } catch {
      throw new NovelOutboxDispatchError(
        NOVEL_OUTBOX_DISPATCH_FAILURE.publisherFailed,
      );
    }
    return captureReceipt(receipt, record);
  }
}

function captureReceipt(
  receipt: OutputReceipt,
  record: NovelLifecycleRecord,
): NovelLifecyclePublicationReceipt {
  if (
    receipt === null ||
    typeof receipt !== "object" ||
    (receipt.status !== OUTPUT_RECEIPT_STATUS.recorded &&
      receipt.status !== OUTPUT_RECEIPT_STATUS.duplicate) ||
    receipt.conversationId !== record.conversationId ||
    receipt.outputEventId !== record.eventId ||
    !Number.isSafeInteger(receipt.sequence) ||
    receipt.sequence < 1
  ) {
    throw new NovelOutboxDispatchError(
      NOVEL_OUTBOX_DISPATCH_FAILURE.invalidPublisherReceipt,
    );
  }
  let recordedAt;
  try {
    recordedAt = captureNovelTimestamp(receipt.recordedAt);
  } catch {
    throw new NovelOutboxDispatchError(
      NOVEL_OUTBOX_DISPATCH_FAILURE.invalidPublisherReceipt,
    );
  }
  return Object.freeze({
    status:
      receipt.status === OUTPUT_RECEIPT_STATUS.recorded
        ? NOVEL_LIFECYCLE_PUBLICATION_STATUS.recorded
        : NOVEL_LIFECYCLE_PUBLICATION_STATUS.duplicate,
    conversationId: receipt.conversationId,
    eventId: receipt.outputEventId,
    sequence: receipt.sequence,
    recordedAt,
  });
}
