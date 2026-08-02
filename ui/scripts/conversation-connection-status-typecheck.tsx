/** Compile-only proof for redacted connection state and explicit resume action. */
import type { ConversationProjectionBindingSnapshot } from "../src/index.js";
import { ConversationConnectionStatus } from "../src/index.js";

declare const snapshot: ConversationProjectionBindingSnapshot;

const status = (
  <ConversationConnectionStatus snapshot={snapshot} resume={async () => undefined} />
);

// @ts-expect-error Connection snapshots are immutable.
snapshot.error.code = "replacement";

void status;
