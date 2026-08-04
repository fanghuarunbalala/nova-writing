/** Compile-only proof for canonical Novel queries in the shared React shell. */
import {
  canonicalNovelQueryScope,
  type NovelApiClient,
} from "@novel/core";
import {
  NovelApp,
  createNovelInspectorRendererRegistry,
} from "../src/index.js";

declare const api: NovelApiClient;

void api.novel.overview.get(canonicalNovelQueryScope);
void createNovelInspectorRendererRegistry();

const element = (
  <NovelApp
    api={api}
    platform={{
      capabilities: {
        fileSelection: false,
        clipboardRead: false,
        clipboardWrite: false,
        notifications: false,
      },
      files: { selectFiles: async () => [] },
      clipboard: {
        readText: async () => "",
        writeText: async () => undefined,
      },
      notifications: { show: async () => undefined },
    }}
    initialShellState={{
      workspace: { id: "workspace", label: "Workspace" },
    }}
  />
);

void element;
