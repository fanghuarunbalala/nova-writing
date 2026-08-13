/**
 * Compile-only proof that Desktop and Web both mount the shared NovelApp
 * (Phase 3+ shell) through their respective renderer entrypoints.
 */
import type { ElectronPreloadBridge } from "../src/shared/index.js";
import { mountDesktopRenderer } from "../src/renderer/index.js";
import { mountWebBrowser } from "../../web/src/browser/index.js";

declare const bridge: ElectronPreloadBridge;
declare const document: Document;
declare const window: Window;

const desktop = mountDesktopRenderer({
  window: { novelDesktop: bridge },
  document,
  rootElementId: "desktop-root",
  appProps: {},
});
const web = mountWebBrowser({
  window,
  document,
  rootElementId: "web-root",
  appProps: {},
});

void desktop.close();
void web.close();
