/** Desktop child stdio entrypoint composing the production Runtime. */
import type { Readable, Writable } from "node:stream";
import { appendFile } from "node:fs/promises";
import {
  BaseContextCompiler,
  type AgentRuntimeConfigurationProfileResolver,
  type AgentRuntimeContextCompilerFactory,
} from "../../../runtime/index.js";
import type {
  ApplicationConfigurationStore,
  CredentialStore,
  DiagnosticLogLevel,
} from "../../../config/index.js";
import {
  NodeApplicationConfigurationStore,
  NodeConfigurationHomeResolver,
  NodePlaintextCredentialStore,
  NodeWorkspaceStoreLocator,
  SqliteWorkspaceStore,
  createNodeProviderRequestDebugRecorder,
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

export const DESKTOP_CHILD_LOG_ENV = "NOVEL_DESKTOP_CHILD_LOG" as const;

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
  const homeResolver = options.homeResolver ?? new NodeConfigurationHomeResolver();
  return initializeDesktopRuntimeChildEntrypoint(options, homeResolver);
}

async function initializeDesktopRuntimeChildEntrypoint(
  options: RunDesktopRuntimeChildEntrypointOptions,
  homeResolver: NodeConfigurationHomeResolver,
): Promise<RuntimeChildEntrypointResult> {
  const bootstrapLogger = createEntrypointLogger(options.logger, "info");
  const application =
    options.application ??
    new NodeApplicationConfigurationStore({
      homeResolver,
      logger: bootstrapLogger,
    });
  const credentials =
    options.credentials ??
    new NodePlaintextCredentialStore({ homeResolver, logger: bootstrapLogger });
  const diagnostics = await application
    .load()
    .then((configuration) => configuration?.diagnostics)
    .catch(() => undefined);
  const logger = createEntrypointLogger(
    options.logger,
    diagnostics?.logLevel ?? "info",
  );
  const debugRecorder =
    diagnostics?.providerRequestDumpEnabled === true &&
    diagnostics.providerRequestDumpPath !== undefined
      ? createNodeProviderRequestDebugRecorder({
          path: diagnostics.providerRequestDumpPath,
          logger,
        })
      : undefined;
  const manifestStoreProvider =
    options.manifestStoreProvider ??
    createEnvManifestStoreProvider(options.storageRoot, logger);
  const adapterFactory =
    options.adapterFactory ??
    new PiRuntimeChildAdapterFactory({
      application,
      credentials,
      logger,
      ...(debugRecorder === undefined ? {} : { debugRecorder }),
    });
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

function createEntrypointLogger(
  explicit: Logger | undefined,
  logLevel: DiagnosticLogLevel,
): Logger {
  if (explicit !== undefined) {
    return explicit.child({ component: "desktop_runtime_child_entrypoint" });
  }
  const logPath = process.env[DESKTOP_CHILD_LOG_ENV];
  if (logPath === undefined || logPath.length === 0) {
    return noopLogger.child({ component: "desktop_runtime_child_entrypoint" });
  }
  const debugEnabled = logLevel === "debug";
  const fileLogger: Logger = {
    debug: (event, fields) => {
      if (debugEnabled) {
        void appendFile(logPath, `DEBUG ${event} ${safeLogFields(fields)}\n`);
      }
    },
    info: (event, fields) =>
      void appendFile(logPath, `INFO ${event} ${safeLogFields(fields)}\n`),
    warn: (event, fields) =>
      void appendFile(logPath, `WARN ${event} ${safeLogFields(fields)}\n`),
    error: (event, fields) =>
      void appendFile(logPath, `ERROR ${event} ${safeLogFields(fields)}\n`),
    child: () => fileLogger,
  };
  return fileLogger;
}

function safeLogFields(fields: Readonly<Record<string, unknown>> | undefined): string {
  if (fields === undefined) return "{}";
  return JSON.stringify(fields);
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
