/** Compile-only proof for Inspector state, lifecycle, and NovelApp injection. */
import type { NovelApiClient } from "@novel/core";
import {
  InspectorStore,
  NovelApp,
  type FrontendPlatform,
  type InspectorTarget,
} from "../src/index.js";

declare const api: NovelApiClient;
declare const platform: FrontendPlatform;

const target: InspectorTarget = {
  key: "character:character-1",
  kind: "character",
  title: "林舟",
  parameters: { novelId: "novel-1", characterId: "character-1" },
};
const store = new InspectorStore({ target, mode: "normal" });
const app = <NovelApp api={api} platform={platform} inspectorStore={store} />;
const snapshot = store.getSnapshot();

// @ts-expect-error Inspector snapshots are immutable.
snapshot.mode = "expanded";
// @ts-expect-error Target parameters are immutable.
snapshot.target.parameters.characterId = "replacement";
// @ts-expect-error Closed is not a valid initial visible mode.
new InspectorStore({ target, mode: "closed" });

void app;
