/** Compile-only proof for the Desktop Runtime child composition root. */
import type { AgentRuntimeConfiguration } from "../src/runtime/index.js";
import {
  DesktopRuntimeChildCompositionFactory,
  runDesktopRuntimeChildEntrypoint,
  type RuntimeChildAdapterFactory,
  type RuntimeRunPreparationSourceFactory,
} from "../src/node/index.js";

declare const adapterFactory: RuntimeChildAdapterFactory;
declare const preparationSourceFactory: RuntimeRunPreparationSourceFactory;
declare const configuration: AgentRuntimeConfiguration;
type AdapterCreateOptions = Parameters<RuntimeChildAdapterFactory["create"]>[0];
declare const lifecycleController: AdapterCreateOptions["lifecycleController"];

const factory = new DesktopRuntimeChildCompositionFactory({
  manifestStoreProvider: async () => {
    throw new Error("unused");
  },
  adapterFactory,
  contextCompilerFactory: { async create() { throw new Error("unused"); } },
  preparationSourceFactory,
});
void factory;
void adapterFactory.create({ configuration, lifecycleController });
void runDesktopRuntimeChildEntrypoint;
