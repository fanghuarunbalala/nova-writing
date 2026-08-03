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

const app = (
  <NovelApp
    api={api}
    platform={platform}
    settingsStore={settingsStore}
    workspaceController={workspaceController}
  />
);

void app;
