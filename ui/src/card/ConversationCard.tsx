/** Safe default card presentation with optional domain renderer and Inspector action. */
import { createElement } from "react";
import {
  emptyConversationCardRendererRegistry,
  type ConversationCardRendererRegistry,
} from "./ConversationCardRendererRegistry.js";
import type { ConversationCardDescriptor } from "./ConversationCardTypes.js";

export interface ConversationCardProps {
  readonly card: ConversationCardDescriptor;
  readonly registry?: ConversationCardRendererRegistry;
  readonly onOpenInspector?: (card: ConversationCardDescriptor) => void;
}

export function ConversationCard({
  card,
  registry = emptyConversationCardRendererRegistry,
  onOpenInspector,
}: ConversationCardProps) {
  const openInspector = card.inspectorTarget === undefined || onOpenInspector === undefined
    ? undefined
    : () => onOpenInspector(card);
  const Renderer = registry.resolve(card.kind);
  if (Renderer !== undefined) {
    return createElement(Renderer, { card, openInspector });
  }
  return (
    <article className="novel-conversation-card" data-card-kind={card.kind}>
      <header className="novel-card-header">
        <span>{card.kind}</span>
        <span className="novel-card-status">{card.status}</span>
      </header>
      <h3>{card.title}</h3>
      {card.summary !== undefined ? <p>{card.summary}</p> : null}
      {openInspector !== undefined ? (
        <button type="button" onClick={openInspector}>
          在右侧查看
        </button>
      ) : null}
    </article>
  );
}
