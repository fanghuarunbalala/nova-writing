/** Launches the built secure Electron desktop application. */
import { app } from "electron";
import { DesktopBootstrapApiTransport } from "./DesktopBootstrapApiTransport.js";
import { resolveDesktopMainPaths } from "./DesktopMainPaths.js";
import { createElectronDesktopApplication } from "./createElectronDesktopApplication.js";

const paths = resolveDesktopMainPaths(import.meta.url);
const application = createElectronDesktopApplication({
  transport: new DesktopBootstrapApiTransport(),
  preloadPath: paths.preloadPath,
  rendererTarget: { kind: "file", filePath: paths.rendererFilePath },
});

let stopping = false;
app.on("before-quit", (event) => {
  if (stopping) return;
  event.preventDefault();
  stopping = true;
  void application.stop().finally(() => app.quit());
});

void application.start().catch(() => {
  console.error(
    JSON.stringify({ level: "error", event: "desktop_main.start_failed" }),
  );
  app.quit();
});
