/** Exposes one frozen desktop API object under the fixed Renderer global key. */
import type { ElectronPreloadBridge } from "../shared/index.js";
import { NOVEL_DESKTOP_BRIDGE_KEY } from "../shared/index.js";
import {
  createElectronPreloadBridge,
  type ElectronIpcRendererPort,
} from "./createElectronPreloadBridge.js";

export interface ElectronContextBridgePort {
  exposeInMainWorld(key: string, api: unknown): void;
}

export interface ExposeDesktopApiOptions {
  readonly contextBridge: ElectronContextBridgePort;
  readonly ipcRenderer: ElectronIpcRendererPort;
}

export function exposeDesktopApi(
  options: ExposeDesktopApiOptions,
): ElectronPreloadBridge {
  const bridge = createElectronPreloadBridge({
    ipcRenderer: options.ipcRenderer,
  });
  options.contextBridge.exposeInMainWorld(NOVEL_DESKTOP_BRIDGE_KEY, bridge);
  return bridge;
}
