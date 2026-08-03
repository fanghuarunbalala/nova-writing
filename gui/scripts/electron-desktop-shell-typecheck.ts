/** Compile-only proof for the secure desktop application composition ports. */
import type { ApiTransport } from "@novel/core";
import {
  DesktopApplication,
  createSecureWindowOptions,
  type DesktopBrowserWindowPort,
  type ElectronAppPort,
  type ElectronIpcMainPort,
} from "../src/main/index.js";

declare const app: ElectronAppPort;
declare const ipcMain: ElectronIpcMainPort;
declare const transport: ApiTransport;
declare const window: DesktopBrowserWindowPort;

const application = new DesktopApplication({
  app,
  ipcMain,
  transport,
  createWindow: () => window,
  preloadPath: "/application/preload.cjs",
  rendererTarget: { kind: "url", url: "http://127.0.0.1:5173" },
  platform: "linux",
});
const options = createSecureWindowOptions("/application/preload.cjs");

void application.start();
void application.stop();
void options;
