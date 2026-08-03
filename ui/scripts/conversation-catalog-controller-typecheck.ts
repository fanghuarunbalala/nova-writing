/** Compile-only proof for Workspace Conversation catalog control. */
import type { NovelApiClient } from "@novel/core";
import { ConversationCatalogController } from "../src/index.js";

declare const api: NovelApiClient;

const controller = new ConversationCatalogController({ api });
const unsubscribe = controller.subscribe(() => undefined);
void controller.openWorkspace("workspace-1");
void controller.createConversation();
void controller.selectConversation("conversation-1");
controller.clearWorkspace();
unsubscribe();
