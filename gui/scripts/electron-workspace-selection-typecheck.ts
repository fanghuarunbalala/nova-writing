/** Compile-only proof for native Workspace selection across Main, Preload, and Renderer. */
import { noopLogger } from "@novel/core";
import type { NodeWorkspaceStoreLocator } from "@novel/core/node";
import {
  DesktopWorkspaceIpcController,
  DesktopWorkspaceService,
  type ElectronIpcMainPort,
} from "../src/main/index.js";
import type { ElectronPreloadBridge } from "../src/shared/index.js";
import { createElectronWorkspaceController } from "../src/renderer/index.js";

declare const locator: NodeWorkspaceStoreLocator;
declare const ipcMain: ElectronIpcMainPort;
declare const bridge: ElectronPreloadBridge;

const service = new DesktopWorkspaceService({
  picker: { pickDirectory: async () => undefined },
  locator,
});
const controller = new DesktopWorkspaceIpcController({
  service,
  authorizeSender: (senderId) => senderId === 1,
});
controller.register(ipcMain);
const workspaceController = createElectronWorkspaceController(bridge, noopLogger);

void workspaceController;
void controller.dispose();
