/** Compile-only proof for provider-neutral Conversation API routing. */
import {
  ConversationApiRouter,
  type ApiTransport,
  type ConversationCommandService,
  type ConversationQueryService,
  type ConversationRuntimePresenceReader,
} from "../src/index.js";

declare const commands: ConversationCommandService;
declare const queries: ConversationQueryService;
declare const runtimePresence: ConversationRuntimePresenceReader;

const router = new ConversationApiRouter({
  commands,
  queries,
  runtimePresence,
});
const transport: ApiTransport = router;

void transport;
void router.close();
