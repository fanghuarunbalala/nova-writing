/** Compile-only proof for Electron Configuration Bridge adaptation. */
import type { ElectronConfigurationBridge } from "../src/shared/index.js";
import { ElectronApplicationConfigurationClient } from "../src/renderer/index.js";

declare const bridge: ElectronConfigurationBridge;

const client = new ElectronApplicationConfigurationClient(bridge);
void client.load();
void client.saveCredential("credential:model", "secret");
void client.upsertModelConfiguration({} as Parameters<
  ElectronApplicationConfigurationClient["upsertModelConfiguration"]
>[0]);
