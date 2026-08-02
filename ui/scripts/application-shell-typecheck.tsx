/** Compile-only proof for the shared Shell slots and Inspector modes. */
import type { NovelApiClient } from "@novel/core";
import {
  NovelApp,
  type FrontendPlatform,
} from "../src/index.js";

declare const api: NovelApiClient;
declare const platform: FrontendPlatform;

const app = (
  <NovelApp
    api={api}
    platform={platform}
    shell={{
      context: { workspace: "Workspace", meta: "Main" },
      conversations: [{ id: "conversation-1", title: "开篇讨论" }],
      inspectorMode: "expanded",
      inspector: <div>Review</div>,
      composer: <div>Composer</div>,
    }}
  >
    <div>Timeline</div>
  </NovelApp>
);

// @ts-expect-error Inspector mode is a closed union.
const invalidMode = <NovelApp api={api} platform={platform} shell={{ inspectorMode: "wide" }} />;

void app;
void invalidMode;
