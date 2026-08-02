/** Compile-only proof for structured Card projector and renderer contracts. */
import type { PersistedOutputEventSnapshot } from "@novel/core";
import {
  ConversationCardProjectorRegistry,
  ConversationCardRendererRegistry,
  type ConversationCardRendererProps,
} from "../src/index.js";

function CardRenderer({ card, openInspector }: ConversationCardRendererProps) {
  return <button onClick={openInspector}>{card.title}</button>;
}

const projectors = new ConversationCardProjectorRegistry([
  {
    eventType: "novel.test.reference",
    projector: (_event: PersistedOutputEventSnapshot) => ({
      cardId: "card-1",
      kind: "novel-reference",
      title: "Reference",
      status: "informational",
    }),
  },
]);
const renderers = new ConversationCardRendererRegistry([
  { kind: "novel-reference", renderer: CardRenderer },
]);

void projectors;
void renderers;
