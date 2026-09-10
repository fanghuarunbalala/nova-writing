/** Compile-only proof for the E2E acceptance smoke wiring. */
import { DesktopNovelWorkspaceApplicationFactory } from "../src/main/index.js";

const factory = new DesktopNovelWorkspaceApplicationFactory({
  storageRoot: "/tmp/storage",
});
void factory;
