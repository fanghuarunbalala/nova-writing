/** Compile-only proof for the Node SQLite Conversation API application. */
import type { ConversationRuntimePlacement, WorkspaceStoreLocation } from "../src/index.js";
import { NodeConversationApiApplication } from "../src/node/index.js";

declare const workspace: WorkspaceStoreLocation;
declare const placement: ConversationRuntimePlacement;

const application = await NodeConversationApiApplication.open({
  workspace,
  placement,
});

void application.transport;
void application.conversations;
await application.close();
