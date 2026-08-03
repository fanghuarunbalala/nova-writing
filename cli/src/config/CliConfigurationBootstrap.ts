/** Loads or initializes the shared Application Configuration before CLI Runtime startup. */
import {
  createDefaultApplicationConfiguration,
  noopLogger,
  type ApplicationConfiguration,
  type ApplicationConfigurationStore,
  type Logger,
} from "@novel/core";
import {
  NodeApplicationConfigurationStore,
  NodeConfigurationHomeResolver,
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
    if (stored !== undefined) {
      this.#logger.info("cli.configuration.load_completed", {
        revision: stored.revision,
        initialized: false,
      });
      return stored;
    }
    const defaults = createDefaultApplicationConfiguration();
    await this.#store.save(defaults);
    this.#logger.info("cli.configuration.load_completed", {
      revision: defaults.revision,
      initialized: true,
    });
    return defaults;
  }
}

export function createDefaultCliConfigurationBootstrap(): CliConfigurationBootstrap {
  const homeResolver = new NodeConfigurationHomeResolver();
  return new CliConfigurationBootstrap({
    store: new NodeApplicationConfigurationStore({ homeResolver }),
  });
}
