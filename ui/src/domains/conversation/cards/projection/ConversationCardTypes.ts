/** Safe view-neutral card descriptors derived from structured OutputEvents. */

export type ConversationCardKind =
  | "novel-reference"
  | "design"
  | "outline-proposal"
  | "manuscript-proposal"
  | "character-proposal"
  | "location-proposal"
  | "task"
  | "approval"
  | "publication";

export type ConversationCardStatus =
  | "informational"
  | "pending"
  | "in-progress"
  | "accepted"
  | "rejected"
  | "completed"
  | "failed"
  | "stale";

export interface ConversationCardProjection {
  readonly cardId: string;
  readonly kind: ConversationCardKind;
  readonly title: string;
  readonly summary?: string;
  readonly status: ConversationCardStatus;
}

export interface ConversationCardDescriptor extends ConversationCardProjection {
  readonly conversationId: string;
  readonly sourceEventId: string;
  readonly sourceSequence: number;
  readonly timestamp: string;
}

const CARD_KINDS = new Set<ConversationCardKind>([
  "novel-reference",
  "design",
  "outline-proposal",
  "manuscript-proposal",
  "character-proposal",
  "location-proposal",
  "task",
  "approval",
  "publication",
]);

const CARD_STATUSES = new Set<ConversationCardStatus>([
  "informational",
  "pending",
  "in-progress",
  "accepted",
  "rejected",
  "completed",
  "failed",
  "stale",
]);

export function captureConversationCardDescriptor(
  descriptor: ConversationCardDescriptor,
): ConversationCardDescriptor {
  if (!Number.isSafeInteger(descriptor.sourceSequence) || descriptor.sourceSequence < 1) {
    throw new TypeError("Conversation Card source sequence is invalid");
  }
  if (!CARD_KINDS.has(descriptor.kind)) {
    throw new TypeError("Conversation Card kind is invalid");
  }
  if (!CARD_STATUSES.has(descriptor.status)) {
    throw new TypeError("Conversation Card status is invalid");
  }
  return Object.freeze({
    cardId: captureText(descriptor.cardId, "Conversation Card id", 200),
    conversationId: captureText(
      descriptor.conversationId,
      "Conversation Card conversation id",
      200,
    ),
    sourceEventId: captureText(
      descriptor.sourceEventId,
      "Conversation Card source Event id",
      200,
    ),
    sourceSequence: descriptor.sourceSequence,
    timestamp: captureText(descriptor.timestamp, "Conversation Card timestamp", 100),
    kind: descriptor.kind,
    title: captureText(descriptor.title, "Conversation Card title", 240),
    ...(descriptor.summary !== undefined
      ? { summary: captureText(descriptor.summary, "Conversation Card summary", 2_000) }
      : {}),
    status: descriptor.status,
  });
}

function captureText(value: string, label: string, maximumLength: number): string {
  const hasControlCharacter = [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > maximumLength ||
    hasControlCharacter
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}
