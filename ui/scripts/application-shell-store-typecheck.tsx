/** Compile-only proof for immutable Shell state and NovelApp Store injection. */
import type { NovelApiClient } from "@novel/core";
import {
  ApplicationShellStore,
  NovelApp,
  type FrontendPlatform,
} from "../src/index.js";

declare const api: NovelApiClient;
declare const platform: FrontendPlatform;

const store = new ApplicationShellStore({
  workspace: { id: "workspace-1", label: "Workspace" },
});
const app = <NovelApp api={api} platform={platform} shellStore={store} />;
const snapshot = store.getSnapshot();

// @ts-expect-error Shell snapshots are immutable.
snapshot.sidebarMode = "collapsed";
// @ts-expect-error Nested context identities are immutable.
snapshot.workspace.label = "Replacement";

void app;
