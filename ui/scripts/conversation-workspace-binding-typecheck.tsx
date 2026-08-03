/** Compile-only proof for Workspace-driven Conversation binding in NovelApp. */
import type { NovelApiClient } from "@novel/core";
import { NovelApp, WorkspaceController } from "../src/index.js";

declare const api: NovelApiClient;

const workspaceController = new WorkspaceController({
  picker: {
    pickWorkspace: async () => ({ referenceId: "workspace-1", label: "Project" }),
  },
  sessions: {
    listRecent: async () => Object.freeze([]),
    open: async () => ({ id: "workspace-1", label: "Project" }),
    close: async () => undefined,
  },
});

void <NovelApp api={api} platform={{} as never} workspaceController={workspaceController} />;
