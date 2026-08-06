/** Structured OutputEvent-to-card projection without Markdown command parsing. */
import type { PersistedOutputEventSnapshot } from "@novel/core";
import {
  captureConversationCardDescriptor,
  type ConversationCardDescriptor,
  type ConversationCardProjection,
} from "./ConversationCardTypes.js";

export type ConversationCardProjector = (
  event: PersistedOutputEventSnapshot,
) => ConversationCardProjection | undefined;

export interface ConversationCardProjectorRegistration {
  readonly eventType: string;
  readonly projector: ConversationCardProjector;
}

export class ConversationCardProjectorRegistry {
  private readonly projectors: ReadonlyMap<string, ConversationCardProjector>;

  constructor(registrations: readonly ConversationCardProjectorRegistration[] = []) {
    const projectors = new Map<string, ConversationCardProjector>();
    for (const registration of registrations) {
      const eventType = requireNonBlank(registration.eventType, "Card projector Event type");
      if (projectors.has(eventType)) {
        throw new TypeError("Card projector Event type must be unique");
      }
      projectors.set(eventType, registration.projector);
    }
    this.projectors = projectors;
  }

  project(event: PersistedOutputEventSnapshot): ConversationCardDescriptor | undefined {
    if (event.direction !== "output") {
      throw new TypeError("Conversation Card projector requires an OutputEvent");
    }
    const projector = this.projectors.get(event.eventType);
    if (projector === undefined) return undefined;
    const projection = projector(event);
    if (projection === undefined) return undefined;
    return captureConversationCardDescriptor({
      ...projection,
      conversationId: event.conversationId,
      sourceEventId: event.id,
      sourceSequence: event.sequence,
      timestamp: event.timestamp,
    });
  }

  projectMany(
    events: readonly PersistedOutputEventSnapshot[],
  ): readonly ConversationCardDescriptor[] {
    const cards = events
        .map((event) => this.project(event))
        .filter((card): card is ConversationCardDescriptor => card !== undefined)
        .sort((left, right) => left.sourceSequence - right.sourceSequence);
    if (new Set(cards.map((card) => card.cardId)).size !== cards.length) {
      throw new TypeError("Conversation Card id must be unique");
    }
    return Object.freeze(cards);
  }
}

function requireNonBlank(value: string, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must not be blank`);
  }
  return value;
}
