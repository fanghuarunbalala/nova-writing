/** Resolves packaged Renderer and Preload assets relative to the Electron Main module. */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface DesktopMainPaths {
  readonly preloadPath: string;
  readonly rendererFilePath: string;
}

export function resolveDesktopMainPaths(moduleUrl: string): DesktopMainPaths {
  const mainDirectory = dirname(fileURLToPath(moduleUrl));
  return Object.freeze({
    preloadPath: resolve(mainDirectory, "../preload/preload.cjs"),
    rendererFilePath: resolve(mainDirectory, "../renderer-app/index.html"),
  });
}
