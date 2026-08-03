/** Compile-only proof for the executable Electron Main bootstrap helpers. */
import type { ApiTransport } from "@novel/core";
import {
  DesktopBootstrapApiTransport,
  resolveDesktopMainPaths,
} from "../src/main/index.js";

const transport: ApiTransport = new DesktopBootstrapApiTransport();
const paths = resolveDesktopMainPaths(import.meta.url);

void transport;
void paths.preloadPath;
void paths.rendererFilePath;
