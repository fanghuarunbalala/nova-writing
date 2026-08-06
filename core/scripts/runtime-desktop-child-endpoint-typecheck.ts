/** Compile-only proof for the desktop child endpoint and placement wiring. */
import {
  DesktopRuntimeChildEndpointFactory,
  createChildProcessConversationRuntimePlacement,
  type DesktopRuntimeChildPersistenceProvider,
} from "../src/node/index.js";

declare const persistenceProvider: DesktopRuntimeChildPersistenceProvider;

const factory = new DesktopRuntimeChildEndpointFactory({
  persistenceProvider,
});
void factory;
void createChildProcessConversationRuntimePlacement({
  command: "node",
  persistenceProvider,
});
