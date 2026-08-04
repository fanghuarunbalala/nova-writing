/** Compile-only proof for default canonical Novel card projectors. */
import type { PersistedOutputEventSnapshot } from "@novel/core";
import {
  ConversationCard,
  createDefaultNovelCardProjectorRegistry,
} from "../src/index.js";

const registry = createDefaultNovelCardProjectorRegistry();
declare const event: PersistedOutputEventSnapshot;
const card = registry.project(event);
if (card !== undefined) {
  const element = (
    <ConversationCard
      card={card}
      onOpenInspector={() => undefined}
    />
  );
  void element;
}
