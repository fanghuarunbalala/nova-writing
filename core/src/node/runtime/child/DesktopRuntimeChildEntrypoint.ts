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
import { EffectiveModelExecutionResolver } from "../../../config/index.js";
import {
  NodeApplicationConfigurationStore,
  NodeConfigurationHomeResolver,
  NodePlaintextCredentialStore,
  NodeSha256PromptDigester,
  NodeWorkspaceStoreLocator,
  SqliteWorkspaceStore,
  createNodeProviderRequestDebugRecorder,
} from "../../index.js";
import type { AgentManifestStore } from "../../../agent/index.js";
import type { ConversationRuntimeBootstrap } from "../../../conversation/index.js";
import type { ConversationCatalogStore } from "../../../storage/index.js";
import {
  noopLogger,
  type LogFields,
  type Logger,
} from "../../../observability/index.js";
import {
  DefaultRuntimeRunPreparationSourceFactory,
} from "./DefaultRuntimeRunPreparationSourceFactory.js";
import { ComposeModeStateProvider } from "../../../runtime/compose/index.js";
import {
  DesktopRuntimeChildCompositionFactory,
  type RuntimeChildAdapterFactory,
  type RuntimeRunPreparationSourceFactory,
} from "./DesktopRuntimeChildCompositionFactory.js";
import { PiRuntimeChildAdapterFactory } from "./PiRuntimeChildAdapterFactory.js";
import { SUPPORTED_PI_EXECUTION_APIS } from "../../../runtime/agent/pi/index.js";
import { createDefaultPromptSectionRegistry } from "../../../prompt/index.js";
import {
  runNodeRuntimeChildEntrypoint,
  type RuntimeChildEntrypointResult,
} from "./RuntimeChildEntrypoint.js";

export const DESKTOP_CHILD_STORAGE_ROOT_ENV =
  "NOVEL_DESKTOP_STORAGE_ROOT" as const;

export const DESKTOP_CHILD_LOG_ENV = "NOVEL_DESKTOP_CHILD_LOG" as const;

export const DESKTOP_CHILD_DEBUG_ENV = "NOVEL_DEBUG" as const;

export const DESKTOP_PROVIDER_REQUEST_DUMP_ENV =
  "NOVEL_PROVIDER_REQUEST_DUMP" as const;

export interface ChildDebugDiagnosticsInput {
  readonly logLevel?: DiagnosticLogLevel;
  readonly providerRequestDumpEnabled?: boolean;
  readonly providerRequestDumpPath?: string;
}

export interface ChildDebugDiagnostics {
  readonly logLevel: DiagnosticLogLevel;
  readonly dumpPath?: string;
}

export function resolveChildDebugDiagnostics(
  input: ChildDebugDiagnosticsInput,
  environment: Readonly<Record<string, string | undefined>>,
): ChildDebugDiagnostics {
  const debugValue = environment[DESKTOP_CHILD_DEBUG_ENV];
  const logLevel =
    debugValue === "verbose"
      ? "verbose"
      : debugValue === "1" || debugValue === "debug"
        ? "debug"
        : (input.logLevel ?? "info");
  const dumpPath =
    environment[DESKTOP_PROVIDER_REQUEST_DUMP_ENV] ??
    (input.providerRequestDumpEnabled === true
      ? input.providerRequestDumpPath
      : undefined);
  return Object.freeze({
    logLevel,
    ...(dumpPath === undefined ? {} : { dumpPath }),
  });
}

export interface RunDesktopRuntimeChildEntrypointOptions {
  readonly manifestStoreProvider?: (
    bootstrap: ConversationRuntimeBootstrap,
  ) => Promise<AgentManifestStore>;
  /** 会话目录 store 提供者(会话 mode 持久化 + hydrate)。可选;不传则 mode 仅内存。 */
  /** Conversation catalog store provider (persistent mode + hydrate). Optional; mode stays in-memory otherwise. */
  readonly conversationCatalogStoreProvider?: (
    bootstrap: ConversationRuntimeBootstrap,
  ) => Promise<ConversationCatalogStore>;
  readonly adapterFactory?: RuntimeChildAdapterFactory;
  readonly contextCompilerFactory?: AgentRuntimeContextCompilerFactory;
  readonly preparationSourceFactory?: RuntimeRunPreparationSourceFactory;
  readonly profileResolver?: AgentRuntimeConfigurationProfileResolver;
  readonly application?: ApplicationConfigurationStore;
  readonly credentials?: CredentialStore;
  /** 可选共享模型解析器；默认按 credentials 构建。Optional shared model resolver; defaults to a credentials-backed one. */
  readonly modelResolver?: EffectiveModelExecutionResolver;
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
  const modelResolver =
    options.modelResolver ??
    new EffectiveModelExecutionResolver({
      credentials,
      supportedApis: SUPPORTED_PI_EXECUTION_APIS,
      logger: bootstrapLogger,
    });
  const diagnostics = await application
    .load()
    .then((configuration) => configuration?.diagnostics)
    .catch(() => undefined);
  const childDebug = resolveChildDebugDiagnostics(
    {
      logLevel: diagnostics?.logLevel,
      providerRequestDumpEnabled: diagnostics?.providerRequestDumpEnabled,
      providerRequestDumpPath: diagnostics?.providerRequestDumpPath,
    },
    process.env,
  );
  const logger = createEntrypointLogger(
    options.logger,
    childDebug.logLevel,
  );
  const debugRecorder =
    childDebug.dumpPath === undefined
      ? undefined
      : createNodeProviderRequestDebugRecorder({
          path: childDebug.dumpPath,
          logger,
        });
  const workspaceStoreProvider = createEnvWorkspaceStoreProvider(
    options.storageRoot,
    logger,
  );
  const manifestStoreProvider =
    options.manifestStoreProvider ??
    (async (bootstrap) => (await workspaceStoreProvider(bootstrap)).agentManifests);
  const conversationCatalogStoreProvider =
    options.conversationCatalogStoreProvider ??
    (async (bootstrap) => (await workspaceStoreProvider(bootstrap)).conversations);
  const adapterFactory =
    options.adapterFactory ??
    new PiRuntimeChildAdapterFactory({
      application,
      credentials,
      resolver: modelResolver,
      logger,
      ...(debugRecorder === undefined ? {} : { debugRecorder }),
    });
  const resolveModelId = async (): Promise<string | undefined> => {
    try {
      const descriptor = await modelResolver.resolve({ application });
      return descriptor.modelId;
    } catch (error) {
      logger.debug("environment.model_resolution_failed", {
        failure: error instanceof Error ? error.name : "unknown",
      });
      return undefined;
    }
  };
  const composeState = new ComposeModeStateProvider();
  const contextCompilerFactory =
    options.contextCompilerFactory ??
    Object.freeze({
      async create() {
        return new BaseContextCompiler({ logger });
      },
    });
  const preparationSourceFactory =
    options.preparationSourceFactory ??
    new DefaultRuntimeRunPreparationSourceFactory({
      composeState,
      sections: createDefaultPromptSectionRegistry(),
      digester: new NodeSha256PromptDigester(),
      resolveModelId,
      logger,
    });
  const compositionFactory = new DesktopRuntimeChildCompositionFactory({
    manifestStoreProvider,
    conversationCatalogStoreProvider,
    adapterFactory,
    contextCompilerFactory,
    preparationSourceFactory,
    composeState,
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
  const levelRank = LOG_LEVEL_RANK[logLevel];
  const writeLine = (
    level: string,
    event: string,
    fields: Readonly<Record<string, unknown>> | undefined,
  ): void => {
    void appendFile(logPath, `${level} ${event} ${safeLogFields(fields)}\n`);
  };
  const fileLogger: Logger = {
    debug: (event, fields) => {
      if (levelRank >= LOG_LEVEL_RANK.debug) {
        writeLine("DEBUG", event, fields);
      }
    },
    info: (event, fields) => {
      if (levelRank >= LOG_LEVEL_RANK.info) writeLine("INFO", event, fields);
    },
    warn: (event, fields) => {
      if (levelRank >= LOG_LEVEL_RANK.warn) writeLine("WARN", event, fields);
    },
    error: (event, fields) => {
      writeLine("ERROR", event, fields);
    },
    ...(levelRank >= LOG_LEVEL_RANK.verbose
      ? {
          verbose: (event: string, fields?: LogFields) => {
            writeLine("VERBOSE", event, fields);
          },
        }
      : {}),
    child: () => fileLogger,
  };
  return fileLogger;
}

const LOG_LEVEL_RANK: Readonly<Record<DiagnosticLogLevel, number>> =
  Object.freeze({
    error: 0,
    warn: 1,
    info: 2,
    debug: 3,
    verbose: 4,
  });

function safeLogFields(fields: Readonly<Record<string, unknown>> | undefined): string {
  if (fields === undefined) return "{}";
  return JSON.stringify(fields);
}

/** 记忆化的 workspace store 提供者:manifest 与 conversation catalog 共享同一打开实例。 */
/** Memoized workspace-store provider: manifest and conversation catalog share one open instance. */
function createEnvWorkspaceStoreProvider(
  storageRoot: string | undefined,
  logger: Logger,
): (bootstrap: ConversationRuntimeBootstrap) => Promise<SqliteWorkspaceStore> {
  let storePromise: Promise<SqliteWorkspaceStore> | undefined;
  return async (bootstrap) => {
    if (storePromise === undefined) {
      const root = storageRoot ?? process.env[DESKTOP_CHILD_STORAGE_ROOT_ENV];
      if (root === undefined || root.length === 0) {
        throw new TypeError("Desktop child storage root is not configured");
      }
      const location = await new NodeWorkspaceStoreLocator({
        storageRoot: root,
      }).resolve(bootstrap.workspace.workdir);
      storePromise = SqliteWorkspaceStore.open({ workspace: location, logger });
      logger.debug("runtime_child.workspace_store_opened");
    }
    return storePromise;
  };
}
