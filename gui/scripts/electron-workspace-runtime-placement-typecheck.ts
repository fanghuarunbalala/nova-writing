/** Compile-only proof for the desktop workspace runtime placement wiring. */
import { DesktopNovelWorkspaceApplicationFactory } from "../src/main/index.js";
import { createDesktopRuntimePlacement } from "../src/main/index.js";

const factory = new DesktopNovelWorkspaceApplicationFactory({
  storageRoot: "/tmp/storage",
});
void factory;
void createDesktopRuntimePlacement({
  storageRoot: "/tmp/storage",
  applicationProvider: async () => undefined,
});
