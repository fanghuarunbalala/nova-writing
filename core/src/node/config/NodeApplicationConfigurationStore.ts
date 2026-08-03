/** Persists the user-level Application Configuration under NOVEL_HOME/config. */
import {
  ApplicationConfiguration,
  type ApplicationConfigurationSnapshot,
  type ApplicationConfigurationStore,
  type ConfigurationHomeResolver,
} from "../../config/index.js";
import { noopLogger, type Logger } from "../../observability/index.js";
import { join } from "node:path";
import { AtomicJsonConfigurationFile } from "./AtomicJsonConfigurationFile.js";

export interface NodeApplicationConfigurationStoreOptions {
  readonly homeResolver: ConfigurationHomeResolver;
  readonly logger?: Logger;
}

export class NodeApplicationConfigurationStore
  implements ApplicationConfigurationStore
{
  readonly #homeResolver: ConfigurationHomeResolver;
  readonly #logger: Logger;
  #file?: Promise<AtomicJsonConfigurationFile<ApplicationConfiguration>>;

  constructor(options: NodeApplicationConfigurationStoreOptions) {
    this.#homeResolver = options.homeResolver;
    this.#logger = (options.logger ?? noopLogger).child({
      component: "node_application_configuration_store",
    });
  }

  async load(): Promise<ApplicationConfiguration | undefined> {
    this.#logger.debug("configuration.application.load_started");
    const configuration = await (await this.#resolveFile()).load();
    this.#logger.info("configuration.application.load_completed", {
      found: configuration !== undefined,
      ...(configuration === undefined ? {} : { revision: configuration.revision }),
    });
    return configuration;
  }

  async save(
    configuration: ApplicationConfiguration,
    expectedRevision?: number,
  ): Promise<void> {
    if (!(configuration instanceof ApplicationConfiguration)) {
      throw new TypeError("Application Configuration is invalid");
    }
    this.#logger.debug("configuration.application.save_started", {
      revision: configuration.revision,
    });
    await (await this.#resolveFile()).save(configuration, expectedRevision);
    this.#logger.info("configuration.application.save_completed", {
      revision: configuration.revision,
    });
  }

  #resolveFile(): Promise<AtomicJsonConfigurationFile<ApplicationConfiguration>> {
    this.#file ??= this.#homeResolver.resolve().then((home) =>
      new AtomicJsonConfigurationFile({
        filePath: join(home.configDir, "application.json"),
        hydrate: (snapshot) =>
          new ApplicationConfiguration(snapshot as ApplicationConfigurationSnapshot),
        snapshot: (configuration) => configuration.toSnapshot(),
      })
    );
    return this.#file;
  }
}
