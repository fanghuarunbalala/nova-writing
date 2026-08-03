/** Launches the built secure Electron desktop application. */
import { join } from "node:path";
import { app, dialog, Menu, safeStorage } from "electron";
import {
  NodeApplicationConfigurationStore,
  NodeConfigurationHomeResolver,
  NodeEncryptedCredentialStore,
  NodeWorkspaceStoreLocator,
} from "@novel/core/node";
import { DesktopBootstrapApiTransport } from "./DesktopBootstrapApiTransport.js";
import { createDesktopApplicationMenuTemplate } from "./DesktopApplicationMenu.js";
import { resolveDesktopMainPaths } from "./DesktopMainPaths.js";
import { DesktopConversationApiApplicationFactory } from "./conversation/index.js";
import {
  DesktopConfigurationService,
  ElectronSafeStorageCredentialCipher,
} from "./config/index.js";
import { createElectronDesktopApplication } from "./createElectronDesktopApplication.js";
import { DesktopWorkspaceService } from "./workspace/index.js";

const paths = resolveDesktopMainPaths(import.meta.url);
const configurationHome = new NodeConfigurationHomeResolver();
const configurationService = new DesktopConfigurationService({
  store: new NodeApplicationConfigurationStore({
    homeResolver: configurationHome,
  }),
  credentials: new NodeEncryptedCredentialStore({
    homeResolver: configurationHome,
    cipher: new ElectronSafeStorageCredentialCipher({ safeStorage }),
  }),
});
const workspaceService = new DesktopWorkspaceService({
  picker: {
    pickDirectory: async () => {
      const result = await dialog.showOpenDialog({
        title: "选择小说项目 Workspace",
        properties: ["openDirectory", "createDirectory"],
      });
      return result.canceled ? undefined : result.filePaths[0];
    },
  },
  locator: new NodeWorkspaceStoreLocator({
    storageRoot: join(app.getPath("userData"), "novel-storage"),
  }),
  applicationFactory: new DesktopConversationApiApplicationFactory(),
});
const bootstrapTransport = new DesktopBootstrapApiTransport();
const application = createElectronDesktopApplication({
  resolveTransport: (senderId) =>
    workspaceService.resolveTransport(senderId) ?? bootstrapTransport,
  preloadPath: paths.preloadPath,
  rendererTarget: { kind: "file", filePath: paths.rendererFilePath },
  workspaceService,
  configurationService,
});
Menu.setApplicationMenu(
  Menu.buildFromTemplate([
    ...createDesktopApplicationMenuTemplate({
      applicationName: "Novel",
      platform: process.platform,
      dispatch: (command) => {
        application.dispatchCommand(command);
      },
    }),
  ]),
);

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
