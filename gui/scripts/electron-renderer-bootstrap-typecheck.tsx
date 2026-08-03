/** Compile-only proof for guarded Electron Renderer composition and mounting. */
import type { ElectronPreloadBridge } from "../src/shared/index.js";
import {
  createDesktopRendererComposition,
  createElectronFrontendPlatform,
  mountDesktopRenderer,
  resolveElectronPreloadBridge,
  type DesktopRendererWindowPort,
} from "../src/renderer/index.js";

declare const bridge: ElectronPreloadBridge;
declare const document: Document;
const windowPort: DesktopRendererWindowPort = { novelDesktop: bridge };

const resolved: ElectronPreloadBridge = resolveElectronPreloadBridge(windowPort);
const platform = createElectronFrontendPlatform();
const composition = createDesktopRendererComposition({
  window: windowPort,
  platform,
});
const mounted = mountDesktopRenderer({
  window: windowPort,
  document,
  platform,
});

void resolved;
void composition.api;
void mounted.close();
