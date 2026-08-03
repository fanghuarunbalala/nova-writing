/** Compile-only proof for same-origin Web composition and browser mounting. */
import {
  createBrowserFrontendPlatform,
  createWebBrowserComposition,
  mountWebBrowser,
  resolveWebApiOrigin,
  type WebBrowserWindowPort,
} from "../src/browser/index.js";

declare const document: Document;
const windowPort: WebBrowserWindowPort = {
  location: { origin: "https://novel.example" },
};
const platform = createBrowserFrontendPlatform();
const origin: string = resolveWebApiOrigin(windowPort.location);
const composition = createWebBrowserComposition({
  window: windowPort,
  platform,
});
const mounted = mountWebBrowser({
  window: windowPort,
  document,
  platform,
});

void origin;
void composition.api;
void mounted.close();
