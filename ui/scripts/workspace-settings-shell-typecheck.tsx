/** Compile-only proof for Workspace and Settings shell injection. */
import type { NovelApiClient } from "@novel/core";
import {
  ApplicationSettingsStore,
  NovelApp,
  WorkspaceController,
  type FrontendPlatform,
  type WorkspacePickerPort,
  type WorkspaceSessionPort,
} from "../src/index.js";

declare const api: NovelApiClient;
declare const platform: FrontendPlatform;
declare const picker: WorkspacePickerPort;
declare const sessions: WorkspaceSessionPort;

const workspaceController = new WorkspaceController({ picker, sessions });
const settingsStore = new ApplicationSettingsStore({ sidebarMode: "expanded" });
const provider = settingsStore.addModelProvider({
  name: "Main",
  providerId: "openai",
  api: "openai-responses",
  modelId: "gpt-5",
});
settingsStore.updateModelProvider(provider.id, {
  name: "Main",
  providerId: "openai",
  api: "openai-responses",
  modelId: "gpt-5.1",
});
settingsStore.setActiveModelProvider(provider.id);

const app = (
  <NovelApp
    api={api}
    platform={platform}
    settingsStore={settingsStore}
    workspaceController={workspaceController}
  />
);

void app;
