/** Compile-only proof for the desktop Conversation entry point. */
import type { WorkspaceStoreLocation } from "../src/index.js";
import {
  DesktopConversationEntry,
  UnavailableConversationRuntimePlacement,
  openDesktopConversationEntry,
} from "../src/node/index.js";

declare const workspace: WorkspaceStoreLocation;

void openDesktopConversationEntry({ workspace });
void UnavailableConversationRuntimePlacement;
void DesktopConversationEntry;
