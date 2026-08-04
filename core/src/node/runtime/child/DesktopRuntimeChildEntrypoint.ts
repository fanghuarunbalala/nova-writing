/** Desktop child stdio entrypoint composing the production Runtime. */
import type { Readable, Writable } from "node:stream";
import type {
  AgentRuntimeConfigurationProfileResolver,
} from "../../../runtime/index.js";
import type { Logger } from "../../../observability/index.js";
import {
  DesktopRuntimeChildCompositionFactory,
  type DesktopRuntimeChildCompositionFactoryOptions,
} from "./DesktopRuntimeChildCompositionFactory.js";
import {
  runNodeRuntimeChildEntrypoint,
  type RuntimeChildEntrypointResult,
} from "./RuntimeChildEntrypoint.js";
import type {
  RuntimeChildAdapterFactory,
  RuntimeRunPreparationSourceFactory,
} from "./DesktopRuntimeChildCompositionFactory.js";

export interface RunDesktopRuntimeChildEntrypointOptions {
  readonly manifestStoreProvider: DesktopRuntimeChildCompositionFactoryOptions["manifestStoreProvider"];
  readonly adapterFactory: RuntimeChildAdapterFactory;
  readonly contextCompilerFactory: DesktopRuntimeChildCompositionFactoryOptions["contextCompilerFactory"];
  readonly preparationSourceFactory: RuntimeRunPreparationSourceFactory;
  readonly profileResolver?: AgentRuntimeConfigurationProfileResolver;
  readonly readable?: Readable;
  readonly writable?: Writable;
  readonly logger?: Logger;
}

export function runDesktopRuntimeChildEntrypoint(
  options: RunDesktopRuntimeChildEntrypointOptions,
): Promise<RuntimeChildEntrypointResult> {
  const compositionFactory = new DesktopRuntimeChildCompositionFactory({
    manifestStoreProvider: options.manifestStoreProvider,
    adapterFactory: options.adapterFactory,
    contextCompilerFactory: options.contextCompilerFactory,
    preparationSourceFactory: options.preparationSourceFactory,
    ...(options.profileResolver === undefined
      ? {}
      : { profileResolver: options.profileResolver }),
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  });
  return runNodeRuntimeChildEntrypoint({
    compositionFactory,
    ...(options.readable === undefined ? {} : { readable: options.readable }),
    ...(options.writable === undefined ? {} : { writable: options.writable }),
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  });
}
