/** Compile-only proof for persisted Model Connection settings. */
import type { ApplicationConfigurationClient } from "../src/index.js";
import {
  ApplicationSettingsStore,
  ModelProviderSettingsPanel,
} from "../src/index.js";

declare const configuration: ApplicationConfigurationClient;

void (
  <ModelProviderSettingsPanel
    configuration={configuration}
    store={new ApplicationSettingsStore()}
  />
);
