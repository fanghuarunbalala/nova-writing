/** Compile-only proof for provider-neutral Conversation API routing. */
import {
  ConversationApiRouter,
  type ApiTransport,
  type ConversationCatalogService,
  type ConversationCommandService,
  type ConversationQueryService,
  type ConversationRuntimePresenceReader,
} from "../src/index.js";

declare const commands: ConversationCommandService;
declare const catalog: ConversationCatalogService;
declare const queries: ConversationQueryService;
declare const runtimePresence: ConversationRuntimePresenceReader;

const router = new ConversationApiRouter({
  catalog,
  commands,
  queries,
  runtimePresence,
});
const transport: ApiTransport = router;

void transport;
void router.close();
