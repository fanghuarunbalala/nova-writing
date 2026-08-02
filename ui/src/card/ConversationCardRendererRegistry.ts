/** Immutable registry for domain-specific Conversation Card React renderers. */
import type { ComponentType } from "react";
import type { ConversationCardDescriptor, ConversationCardKind } from "./ConversationCardTypes.js";

export interface ConversationCardRendererProps {
  readonly card: ConversationCardDescriptor;
  readonly openInspector?: () => void;
}

export type ConversationCardRenderer = ComponentType<ConversationCardRendererProps>;

export interface ConversationCardRendererRegistration {
  readonly kind: ConversationCardKind;
  readonly renderer: ConversationCardRenderer;
}

export class ConversationCardRendererRegistry {
  private readonly renderers: ReadonlyMap<ConversationCardKind, ConversationCardRenderer>;

  constructor(registrations: readonly ConversationCardRendererRegistration[] = []) {
    const renderers = new Map<ConversationCardKind, ConversationCardRenderer>();
    for (const registration of registrations) {
      if (renderers.has(registration.kind)) {
        throw new TypeError("Conversation Card renderer kind must be unique");
      }
      renderers.set(registration.kind, registration.renderer);
    }
    this.renderers = renderers;
  }

  resolve(kind: ConversationCardKind): ConversationCardRenderer | undefined {
    return this.renderers.get(kind);
  }
}

export const emptyConversationCardRendererRegistry =
  new ConversationCardRendererRegistry();
