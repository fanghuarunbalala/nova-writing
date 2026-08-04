/** Compile-only proof for the Pi child Runtime adapter factory. */
import { PiRuntimeChildAdapterFactory } from "../src/node/index.js";
import type { ApplicationConfigurationStore, CredentialStore } from "../src/index.js";

declare const application: ApplicationConfigurationStore;
declare const credentials: CredentialStore;

const factory = new PiRuntimeChildAdapterFactory({ application, credentials });
void factory;
