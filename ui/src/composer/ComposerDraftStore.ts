/** Conversation-scoped local draft state for text and structured UI references. */
import {
  captureComposerContentReference,
  sameComposerContentReference,
  type ComposerContentReference,
} from "./ComposerContentReference.js";

export interface ComposerDraftInitialState {
  readonly conversationId: string;
  readonly text?: string;
  readonly references?: readonly ComposerContentReference[];
}

export interface ComposerDraftSnapshot {
  readonly conversationId: string;
  readonly revision: number;
  readonly text: string;
  readonly references: readonly ComposerContentReference[];
}

export type ComposerDraftListener = () => void;

export class ComposerDraftStore {
  private readonly listeners = new Set<ComposerDraftListener>();
  private readonly snapshots = new Map<string, ComposerDraftSnapshot>();

  constructor(initialDrafts: readonly ComposerDraftInitialState[] = []) {
    for (const initial of initialDrafts) {
      const conversationId = requireNonBlank(
        initial.conversationId,
        "Composer conversation id",
      );
      if (this.snapshots.has(conversationId)) {
        throw new TypeError("Composer initial conversation ids must be unique");
      }
      this.snapshots.set(
        conversationId,
        buildSnapshot(conversationId, 0, initial.text ?? "", initial.references ?? []),
      );
    }
  }

  getSnapshot(conversationId: string): ComposerDraftSnapshot {
    const capturedId = requireNonBlank(conversationId, "Composer conversation id");
    const existing = this.snapshots.get(capturedId);
    if (existing !== undefined) return existing;
    const snapshot = buildSnapshot(capturedId, 0, "", []);
    this.snapshots.set(capturedId, snapshot);
    return snapshot;
  }

  subscribe(listener: ComposerDraftListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setText(conversationId: string, text: string): void {
    if (typeof text !== "string" || /\u0000/u.test(text)) {
      throw new TypeError("Composer draft text is invalid");
    }
    const current = this.getSnapshot(conversationId);
    if (current.text === text) return;
    this.publish(current.conversationId, text, current.references);
  }

  addReference(
    conversationId: string,
    reference: ComposerContentReference,
  ): void {
    const current = this.getSnapshot(conversationId);
    const captured = captureComposerContentReference(reference);
    const existing = current.references.find((item) => item.key === captured.key);
    if (existing !== undefined) {
      if (sameComposerContentReference(existing, captured)) return;
      throw new TypeError("Composer reference key is already bound");
    }
    this.publish(current.conversationId, current.text, [
      ...current.references,
      captured,
    ]);
  }

  removeReference(conversationId: string, referenceKey: string): void {
    const current = this.getSnapshot(conversationId);
    const capturedKey = requireNonBlank(referenceKey, "Composer reference key");
    const references = current.references.filter(
      (reference) => reference.key !== capturedKey,
    );
    if (references.length === current.references.length) return;
    this.publish(current.conversationId, current.text, references);
  }

  clear(conversationId: string): void {
    const current = this.getSnapshot(conversationId);
    if (current.text.length === 0 && current.references.length === 0) return;
    this.publish(current.conversationId, "", []);
  }

  private publish(
    conversationId: string,
    text: string,
    references: readonly ComposerContentReference[],
  ): void {
    const current = this.getSnapshot(conversationId);
    this.snapshots.set(
      conversationId,
      buildSnapshot(conversationId, current.revision + 1, text, references),
    );
    for (const listener of [...this.listeners]) listener();
  }
}

function buildSnapshot(
  conversationId: string,
  revision: number,
  text: string,
  references: readonly ComposerContentReference[],
): ComposerDraftSnapshot {
  return Object.freeze({
    conversationId,
    revision,
    text,
    references: Object.freeze(references.map(captureComposerContentReference)),
  });
}

function requireNonBlank(value: string, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must not be blank`);
  }
  return value;
}
