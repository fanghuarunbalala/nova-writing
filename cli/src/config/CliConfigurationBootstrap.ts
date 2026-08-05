/** Loads or initializes the shared Application Configuration before CLI Runtime startup. */
import {
  ApplicationConfiguration,
  createDefaultApplicationConfiguration,
  noopLogger,
  type ApplicationConfigurationStore,
  type Logger,
} from "@novel/core";
import {
  NodeApplicationConfigurationStore,
  NodeConfigurationHomeResolver,
  resolveChildDebugDiagnostics,
} from "@novel/core/node";

export interface CliConfigurationBootstrapOptions {
  readonly store: ApplicationConfigurationStore;
  readonly logger?: Logger;
}

export class CliConfigurationBootstrap {
  readonly #store: ApplicationConfigurationStore;
  readonly #logger: Logger;

  constructor(options: CliConfigurationBootstrapOptions) {
    this.#store = options.store;
    this.#logger = (options.logger ?? noopLogger).child({
      component: "cli_configuration_bootstrap",
    });
  }

  async load(): Promise<ApplicationConfiguration> {
    this.#logger.debug("cli.configuration.load_started");
    const stored = await this.#store.load();
    const configuration =
      stored ?? createDefaultApplicationConfiguration();
    if (stored === undefined) {
      await this.#store.save(configuration);
    }
    const resolved = resolveChildDebugDiagnostics(
      {
        logLevel: configuration.diagnostics.logLevel,
        providerRequestDumpEnabled:
          configuration.diagnostics.providerRequestDumpEnabled,
        providerRequestDumpPath:
          configuration.diagnostics.providerRequestDumpPath,
      },
      process.env,
    );
    const overridden =
      resolved.logLevel !== configuration.diagnostics.logLevel ||
      resolved.dumpPath !== configuration.diagnostics.providerRequestDumpPath ||
      (resolved.dumpPath !== undefined) !==
        (configuration.diagnostics.providerRequestDumpEnabled === true);
    const effective = overridden
      ? new ApplicationConfiguration({
          ...configuration.toSnapshot(),
          diagnostics: {
            ...configuration.diagnostics.toSnapshot(),
            logLevel: resolved.logLevel,
            providerRequestDumpEnabled: resolved.dumpPath !== undefined,
            ...(resolved.dumpPath === undefined
              ? {}
              : { providerRequestDumpPath: resolved.dumpPath }),
          },
        })
      : configuration;
    this.#logger.info("cli.configuration.load_completed", {
      revision: effective.revision,
      initialized: stored === undefined,
      debug: effective.diagnostics.logLevel,
    });
    return effective;
  }
}

export function createDefaultCliConfigurationBootstrap(): CliConfigurationBootstrap {
  const homeResolver = new NodeConfigurationHomeResolver();
  return new CliConfigurationBootstrap({
    store: new NodeApplicationConfigurationStore({ homeResolver }),
  });
}
