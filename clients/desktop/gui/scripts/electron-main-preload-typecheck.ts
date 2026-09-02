/** Compile-only proof for the fixed Main-to-Preload Electron IPC boundary. */
import type { ApiTransport } from "@novel/core";
import {
  DesktopApiIpcController,
  type ElectronIpcMainPort,
} from "../src/main/index.js";
import {
  createElectronPreloadBridge,
  exposeDesktopApi,
  type ElectronContextBridgePort,
  type ElectronIpcRendererPort,
} from "../src/preload/index.js";
import type { ElectronPreloadBridge } from "../src/shared/index.js";

declare const transport: ApiTransport;
declare const ipcMain: ElectronIpcMainPort;
declare const ipcRenderer: ElectronIpcRendererPort;
declare const contextBridge: ElectronContextBridgePort;

const controller = new DesktopApiIpcController({
  transport,
  authorizeSender: (senderId) => senderId === 1,
});
controller.register(ipcMain);

const created: ElectronPreloadBridge = createElectronPreloadBridge({ ipcRenderer });
const exposed: ElectronPreloadBridge = exposeDesktopApi({
  contextBridge,
  ipcRenderer,
});

void created;
void exposed;
void controller.releaseSender(1);
void controller.dispose();
