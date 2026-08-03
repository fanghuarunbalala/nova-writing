/** Resolves and initializes the shared NOVEL_HOME layout for Node-based hosts. */
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type {
  ConfigurationHome,
  ConfigurationHomeResolver,
} from "../../config/index.js";
import { noopLogger, type Logger } from "../../observability/index.js";

export interface NodeConfigurationHomeResolverOptions {
  readonly rootDir?: string;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly homeDir?: string;
  readonly logger?: Logger;
}

export class NodeConfigurationHomeResolver implements ConfigurationHomeResolver {
  readonly #rootDir?: string;
  readonly #environment: Readonly<Record<string, string | undefined>>;
  readonly #homeDir: string;
  readonly #logger: Logger;

  constructor(options: NodeConfigurationHomeResolverOptions = {}) {
    this.#rootDir = options.rootDir;
    this.#environment = options.environment ?? process.env;
    this.#homeDir = options.homeDir ?? homedir();
    this.#logger = (options.logger ?? noopLogger).child({
      component: "node_configuration_home_resolver",
    });
  }

  async resolve(): Promise<ConfigurationHome> {
    this.#logger.debug("configuration.home.resolve_started");
    const rootDir = resolve(
      this.#rootDir ?? this.#environment.NOVEL_HOME ?? join(this.#homeDir, ".novel"),
    );
    const home = Object.freeze({
      rootDir,
      configDir: join(rootDir, "config"),
      credentialsDir: join(rootDir, "credentials"),
      cacheDir: join(rootDir, "cache"),
      logsDir: join(rootDir, "logs"),
      diagnosticsDir: join(rootDir, "diagnostics"),
    });
    await Promise.all([
      home.configDir,
      home.credentialsDir,
      home.cacheDir,
      home.logsDir,
      home.diagnosticsDir,
    ].map((directory) => mkdir(directory, { recursive: true, mode: 0o700 })));
    this.#logger.info("configuration.home.resolve_completed");
    return home;
  }
}
