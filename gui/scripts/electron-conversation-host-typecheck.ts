/** Compile-only proof for the Workspace-bound desktop Conversation application. */
import { DefaultNovelApiClient } from "@novel/core";
import type { NodeWorkspaceStoreLocator } from "@novel/core/node";
import {
  DesktopNovelWorkspaceApplicationFactory,
  DesktopWorkspaceService,
} from "../src/main/index.js";

declare const locator: NodeWorkspaceStoreLocator;

const service = new DesktopWorkspaceService({
  picker: { pickDirectory: async () => undefined },
  locator,
  applicationFactory: new DesktopNovelWorkspaceApplicationFactory(),
});
const transport = service.resolveTransport(1);
const api = transport === undefined ? undefined : new DefaultNovelApiClient({ transport });

void api?.conversations.list();
