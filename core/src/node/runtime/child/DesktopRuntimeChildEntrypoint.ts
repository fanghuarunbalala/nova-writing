/** Desktop child stdio entrypoint composing the production Runtime. */
import type { Readable, Writable } from "node:stream";
import {
  BaseContextCompiler,
  type AgentRuntimeConfigurationProfileResolver,
  type AgentRuntimeContextCompilerFactory,
} from "../../../runtime/index.js";
import type {
  ApplicationConfigurationStore,
  CredentialStore,
} from "../../../config/index.js";
import {
  NodeApplicationConfigurationStore,
  NodeConfigurationHomeResolver,
  NodePlaintextCredentialStore,
  NodeWorkspaceStoreLocator,
  SqliteWorkspaceStore,
} from "../../index.js";
import type { AgentManifestStore } from "../../../agent/index.js";
import type { ConversationRuntimeBootstrap } from "../../../conversation/index.js";
import { noopLogger, type Logger } from "../../../observability/index.js";
import {
  DefaultRuntimeRunPreparationSourceFactory,
} from "./DefaultRuntimeRunPreparationSourceFactory.js";
import {
  DesktopRuntimeChildCompositionFactory,
  type RuntimeChildAdapterFactory,
  type RuntimeRunPreparationSourceFactory,
} from "./DesktopRuntimeChildCompositionFactory.js";
import { PiRuntimeChildAdapterFactory } from "./PiRuntimeChildAdapterFactory.js";
import {
  runNodeRuntimeChildEntrypoint,
  type RuntimeChildEntrypointResult,
} from "./RuntimeChildEntrypoint.js";

export const DESKTOP_CHILD_STORAGE_ROOT_ENV =
  "NOVEL_DESKTOP_STORAGE_ROOT" as const;

export interface RunDesktopRuntimeChildEntrypointOptions {
  readonly manifestStoreProvider?: (
    bootstrap: ConversationRuntimeBootstrap,
  ) => Promise<AgentManifestStore>;
  readonly adapterFactory?: RuntimeChildAdapterFactory;
  readonly contextCompilerFactory?: AgentRuntimeContextCompilerFactory;
  readonly preparationSourceFactory?: RuntimeRunPreparationSourceFactory;
  readonly profileResolver?: AgentRuntimeConfigurationProfileResolver;
  readonly application?: ApplicationConfigurationStore;
  readonly credentials?: CredentialStore;
  readonly storageRoot?: string;
  readonly homeResolver?: NodeConfigurationHomeResolver;
  readonly readable?: Readable;
  readonly writable?: Writable;
  readonly logger?: Logger;
}

export function runDesktopRuntimeChildEntrypoint(
  options: RunDesktopRuntimeChildEntrypointOptions = {},
): Promise<RuntimeChildEntrypointResult> {
  const logger = (options.logger ?? noopLogger).child({
    component: "desktop_runtime_child_entrypoint",
  });
  const homeResolver = options.homeResolver ?? new NodeConfigurationHomeResolver();
  const application =
    options.application ??
    new NodeApplicationConfigurationStore({ homeResolver, logger });
  const credentials =
    options.credentials ??
    new NodePlaintextCredentialStore({ homeResolver, logger });
  const manifestStoreProvider =
    options.manifestStoreProvider ??
    createEnvManifestStoreProvider(options.storageRoot, logger);
  const adapterFactory =
    options.adapterFactory ??
    new PiRuntimeChildAdapterFactory({ application, credentials, logger });
  const contextCompilerFactory =
    options.contextCompilerFactory ??
    Object.freeze({
      async create() {
        return new BaseContextCompiler({ logger });
      },
    });
  const preparationSourceFactory =
    options.preparationSourceFactory ??
    new DefaultRuntimeRunPreparationSourceFactory({ logger });
  const compositionFactory = new DesktopRuntimeChildCompositionFactory({
    manifestStoreProvider,
    adapterFactory,
    contextCompilerFactory,
    preparationSourceFactory,
    ...(options.profileResolver === undefined
      ? {}
      : { profileResolver: options.profileResolver }),
    logger,
  });
  return runNodeRuntimeChildEntrypoint({
    compositionFactory,
    ...(options.readable === undefined ? {} : { readable: options.readable }),
    ...(options.writable === undefined ? {} : { writable: options.writable }),
    logger,
  });
}

function createEnvManifestStoreProvider(
  storageRoot: string | undefined,
  logger: Logger,
): (bootstrap: ConversationRuntimeBootstrap) => Promise<AgentManifestStore> {
  return async (bootstrap) => {
    const root =
      storageRoot ?? process.env[DESKTOP_CHILD_STORAGE_ROOT_ENV];
    if (root === undefined || root.length === 0) {
      throw new TypeError("Desktop child storage root is not configured");
    }
    const location = await new NodeWorkspaceStoreLocator({
      storageRoot: root,
    }).resolve(bootstrap.workspace.workdir);
    const store = await SqliteWorkspaceStore.open({
      workspace: location,
      logger,
    });
    logger.debug("runtime_child.manifest_store_opened");
    return store.agentManifests;
  };
}
