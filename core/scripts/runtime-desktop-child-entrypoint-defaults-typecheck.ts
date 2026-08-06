/** Compile-only proof for the desktop child entrypoint production defaults. */
import {
  DESKTOP_CHILD_STORAGE_ROOT_ENV,
  runDesktopRuntimeChildEntrypoint,
} from "../src/node/index.js";

void DESKTOP_CHILD_STORAGE_ROOT_ENV;
void runDesktopRuntimeChildEntrypoint();
