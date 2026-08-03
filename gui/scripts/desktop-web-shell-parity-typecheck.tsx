/** Compile-only proof that Desktop and Web mount the same shared application contract. */
import type { ElectronPreloadBridge } from "../src/shared/index.js";
import { mountDesktopRenderer } from "../src/renderer/index.js";
import { mountWebBrowser } from "../../web/src/browser/index.js";

declare const bridge: ElectronPreloadBridge;
declare const document: Document;
declare const window: Window;

const appProps = {
  initialShellState: {
    workspace: { id: "workspace-1", label: "Workspace One" },
    novel: { id: "novel-1", label: "Novel One" },
  },
};
const desktop = mountDesktopRenderer({
  window: { novelDesktop: bridge },
  document,
  rootElementId: "desktop-root",
  appProps,
});
const web = mountWebBrowser({
  window,
  document,
  rootElementId: "web-root",
  appProps,
});

void desktop.close();
void web.close();
