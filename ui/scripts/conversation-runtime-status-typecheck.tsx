/** Compile-only proof for the desktop Runtime status UI. */
import {
  ConversationRuntimeStatusView,
  useConversationRuntimeStatus,
  type ConversationProjectionBindingSnapshot,
} from "../src/index.js";

declare const snapshot: ConversationProjectionBindingSnapshot;

void useConversationRuntimeStatus(snapshot);
const element = (
  <ConversationRuntimeStatusView
    status="generating"
    onStop={() => undefined}
  />
);
void element;
