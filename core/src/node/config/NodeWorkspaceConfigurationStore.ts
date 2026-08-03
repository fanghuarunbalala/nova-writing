/** Persists one Workspace Configuration inside its mapped Store Directory. */
import { join } from "node:path";
import {
  WorkspaceConfiguration,
  type WorkspaceConfigurationSnapshot,
  type WorkspaceConfigurationStore,
} from "../../config/index.js";
import { noopLogger, type Logger } from "../../observability/index.js";
import type { WorkspaceStoreLocator } from "../../storage/index.js";
import { AtomicJsonConfigurationFile } from "./AtomicJsonConfigurationFile.js";
import {
  NODE_CONFIGURATION_STORE_FAILURE,
  NodeConfigurationStoreError,
} from "./NodeConfigurationStoreErrors.js";

export interface NodeWorkspaceConfigurationStoreOptions {
  readonly locator: WorkspaceStoreLocator;
  readonly logger?: Logger;
}

export class NodeWorkspaceConfigurationStore implements WorkspaceConfigurationStore {
  readonly #locator: WorkspaceStoreLocator;
  readonly #logger: Logger;
  readonly #files = new Map<
    string,
    Promise<AtomicJsonConfigurationFile<WorkspaceConfiguration>>
  >();

  constructor(options: NodeWorkspaceConfigurationStoreOptions) {
    this.#locator = options.locator;
    this.#logger = (options.logger ?? noopLogger).child({
      component: "node_workspace_configuration_store",
    });
  }

  async load(workspaceId: string): Promise<WorkspaceConfiguration | undefined> {
    this.#logger.debug("configuration.workspace.load_started", { workspaceId });
    const file = await this.#resolveFile(workspaceId, false);
    if (file === undefined) return undefined;
    const configuration = await file.load();
    this.#logger.info("configuration.workspace.load_completed", {
      workspaceId,
      found: configuration !== undefined,
      ...(configuration === undefined ? {} : { revision: configuration.revision }),
    });
    return configuration;
  }

  async save(
    configuration: WorkspaceConfiguration,
    expectedRevision?: number,
  ): Promise<void> {
    if (!(configuration instanceof WorkspaceConfiguration)) {
      throw new TypeError("Workspace Configuration is invalid");
    }
    this.#logger.debug("configuration.workspace.save_started", {
      workspaceId: configuration.workspaceId,
      revision: configuration.revision,
    });
    const file = await this.#resolveFile(configuration.workspaceId, true);
    await file!.save(configuration, expectedRevision);
    this.#logger.info("configuration.workspace.save_completed", {
      workspaceId: configuration.workspaceId,
      revision: configuration.revision,
    });
  }

  async #resolveFile(
    workspaceId: string,
    required: boolean,
  ): Promise<AtomicJsonConfigurationFile<WorkspaceConfiguration> | undefined> {
    const existing = this.#files.get(workspaceId);
    if (existing !== undefined) return existing;
    const location = await this.#locator.getByWorkspaceId(workspaceId);
    if (location === undefined) {
      if (required) {
        throw new NodeConfigurationStoreError(
          NODE_CONFIGURATION_STORE_FAILURE.workspaceMissing,
        );
      }
      return undefined;
    }
    const pending = Promise.resolve(
      new AtomicJsonConfigurationFile({
        filePath: join(location.storeDir, "config", "workspace.json"),
        hydrate: (snapshot) =>
          new WorkspaceConfiguration(snapshot as WorkspaceConfigurationSnapshot),
        snapshot: (configuration) => configuration.toSnapshot(),
      }),
    );
    this.#files.set(workspaceId, pending);
    return pending;
  }
}
