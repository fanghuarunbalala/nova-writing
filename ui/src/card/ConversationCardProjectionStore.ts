/** Single-stream Card projection layered onto the Core Conversation Projection Store. */
import {
  ConversationProjectionStore,
  noopLogger,
  type ConversationProjectionApplyResult,
  type ConversationProjectionStoreOptions,
  type Logger,
  type PersistedConversationEventSnapshot,
} from "@novel/core";
import {
  ConversationCardProjectorRegistry,
} from "./ConversationCardProjectorRegistry.js";
import type { ConversationCardDescriptor } from "./ConversationCardTypes.js";

export interface ConversationCardProjectionSnapshot {
  readonly revision: number;
  readonly cards: readonly ConversationCardDescriptor[];
}

export interface ConversationCardProjectionStoreOptions
  extends ConversationProjectionStoreOptions {
  readonly projectors?: ConversationCardProjectorRegistry;
}

export class ConversationCardProjectionStore extends ConversationProjectionStore {
  private readonly projectors: ConversationCardProjectorRegistry;
  private readonly cardLogger: Logger;
  private readonly projectionCanonicalByEventId = new Map<string, string | null>();
  private readonly cardsById = new Map<string, ConversationCardDescriptor>();
  private cardRevision = 0;
  private cardSnapshot: ConversationCardProjectionSnapshot = Object.freeze({
    revision: 0,
    cards: Object.freeze([]),
  });

  constructor(options: ConversationCardProjectionStoreOptions) {
    super(options);
    this.projectors = options.projectors ?? new ConversationCardProjectorRegistry();
    this.cardLogger = (options.logger ?? noopLogger).child({
      component: "conversation_card_projection_store",
      conversationId: this.conversationId,
    });
  }

  getCardSnapshot(): ConversationCardProjectionSnapshot {
    return this.cardSnapshot;
  }

  override apply(
    event: PersistedConversationEventSnapshot,
  ): ConversationProjectionApplyResult {
    const card = event.direction === "output" ? this.projectors.project(event) : undefined;
    const canonical = event.direction === "output" ? JSON.stringify(card ?? null) : undefined;
    const previousCanonical = this.projectionCanonicalByEventId.get(event.id);
    if (previousCanonical !== undefined && previousCanonical !== canonical) {
      throw new TypeError("Conversation Card projection changed for an applied Event");
    }
    if (
      card !== undefined &&
      this.cardsById.has(card.cardId) &&
      this.cardsById.get(card.cardId)?.sourceEventId !== event.id
    ) {
      throw new TypeError("Conversation Card id belongs to another Event");
    }

    const staged = event.direction === "output" && previousCanonical === undefined;
    const previousSnapshot = this.cardSnapshot;
    const previousRevision = this.cardRevision;
    if (staged) {
      this.projectionCanonicalByEventId.set(event.id, canonical ?? null);
      if (card !== undefined) {
        this.cardsById.set(card.cardId, card);
        this.cardRevision += 1;
        this.cardSnapshot = this.buildCardSnapshot();
      }
    }
    try {
      const result = super.apply(event);
      if (result === "duplicate" && staged) {
        throw new TypeError("Conversation Card projection was missing for a duplicate Event");
      }
      if (result === "applied" && card !== undefined) {
        this.cardLogger.debug("novel_ui.conversation_card.projected", {
          eventId: event.id,
          eventType: event.eventType,
          cardId: card.cardId,
          cardKind: card.kind,
          sequence: event.sequence,
        });
      }
      return result;
    } catch (error) {
      if (staged) {
        this.projectionCanonicalByEventId.delete(event.id);
        if (card !== undefined) this.cardsById.delete(card.cardId);
        this.cardRevision = previousRevision;
        this.cardSnapshot = previousSnapshot;
      }
      throw error;
    }
  }

  private buildCardSnapshot(): ConversationCardProjectionSnapshot {
    return Object.freeze({
      revision: this.cardRevision,
      cards: Object.freeze(
        [...this.cardsById.values()].sort(
          (left, right) => left.sourceSequence - right.sourceSequence,
        ),
      ),
    });
  }
}
