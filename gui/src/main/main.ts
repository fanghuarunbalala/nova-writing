/** Launches the built secure Electron desktop application. */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { app, dialog, Menu, safeStorage } from "electron";
import {
  NodeApplicationConfigurationStore,
  NodeConfigurationHomeResolver,
  NodeCredentialMigrationStateStore,
  NodeEncryptedCredentialStore,
  NodeLegacyCredentialMigrator,
  NodePlaintextCredentialStore,
  NodeWorkspaceStoreLocator,
} from "@novel/core/node";
import { DesktopBootstrapApiTransport } from "./DesktopBootstrapApiTransport.js";
import { createDesktopApplicationMenuTemplate } from "./DesktopApplicationMenu.js";
import { resolveDesktopMainPaths } from "./DesktopMainPaths.js";
import {
  DesktopConfigurationService,
  DesktopCredentialMigrationCoordinator,
  ElectronSafeStorageCredentialCipher,
} from "./config/index.js";
import { createElectronDesktopApplication } from "./createElectronDesktopApplication.js";
import { createMainProcessLogger } from "./MainProcessLogger.js";
import {
  DesktopNovelWorkspaceApplicationFactory,
  DesktopWorkspaceService,
} from "./workspace/index.js";

const paths = resolveDesktopMainPaths(import.meta.url);
const buildMode = await readBuildMode(import.meta.url);
const manualDebug = process.env.NOVEL_DEBUG;
const manualDump = process.env.NOVEL_PROVIDER_REQUEST_DUMP;
const debugLogLevel =
  manualDebug === "verbose"
    ? "verbose"
    : manualDebug === "1" || manualDebug === "debug"
      ? "debug"
      : buildMode === "debug"
        ? "verbose"
        : undefined;
const providerRequestDumpPath =
  manualDump ??
  (buildMode === "debug"
    ? join(app.getPath("userData"), "debug", "provider-requests.jsonl")
    : undefined);
const configurationHome = new NodeConfigurationHomeResolver();
const configurationStore = new NodeApplicationConfigurationStore({
  homeResolver: configurationHome,
});
const plaintextCredentialStore = new NodePlaintextCredentialStore({
  homeResolver: configurationHome,
});
const legacyCredentialStore = new NodeEncryptedCredentialStore({
  homeResolver: configurationHome,
  cipher: new ElectronSafeStorageCredentialCipher({ safeStorage }),
});
const credentialMigration = new DesktopCredentialMigrationCoordinator({
  store: configurationStore,
  migrator: new NodeLegacyCredentialMigrator({
    legacyStore: legacyCredentialStore,
    plaintextStore: plaintextCredentialStore,
    stateStore: new NodeCredentialMigrationStateStore({
      homeResolver: configurationHome,
    }),
  }),
});
const configurationService = new DesktopConfigurationService({
  store: configurationStore,
  credentials: plaintextCredentialStore,
});
const mainLogger = createMainProcessLogger(
  join(app.getPath("userData"), "runtime-main.log"),
);
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
  applicationFactory: new DesktopNovelWorkspaceApplicationFactory({
    storageRoot: join(app.getPath("userData"), "novel-storage"),
    childLogPath: join(app.getPath("userData"), "runtime-child.log"),
    logger: mainLogger,
    ...(debugLogLevel === undefined ? {} : { debugLogLevel }),
    ...(providerRequestDumpPath === undefined
      ? {}
      : { providerRequestDumpPath }),
  }),
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

void startDesktopApplication().catch(() => {
  console.error(
    JSON.stringify({ level: "error", event: "desktop_main.start_failed" }),
  );
  app.quit();
});

async function startDesktopApplication(): Promise<void> {
  await app.whenReady();
  await credentialMigration.migrateKnownCredentials();
  await application.start();
}

async function readBuildMode(entryModuleUrl: string): Promise<"debug" | "release"> {
  try {
    const raw = await readFile(
      join(dirname(fileURLToPath(entryModuleUrl)), "..", "build-mode.json"),
      "utf8",
    );
    const parsed = JSON.parse(raw) as { mode?: string };
    return parsed.mode === "debug" ? "debug" : "release";
  } catch {
    return "release";
  }
}
