/** Migrates every Credential Reference reachable from desktop Application Configuration. */
import {
  CredentialReference,
  noopLogger,
  type ApplicationConfiguration,
  type ApplicationConfigurationStore,
  type Logger,
} from "@novel/core";
import {
  CREDENTIAL_MIGRATION_OUTCOME,
  type CredentialMigrationResult,
} from "@novel/core/node";
export interface DesktopCredentialMigratorPort {
  migrate(reference: CredentialReference): Promise<CredentialMigrationResult>;
}

export interface DesktopCredentialMigrationSummary {
  readonly referenceCount: number;
  readonly notRequiredCount: number;
  readonly alreadyMigratedCount: number;
  readonly migratedCount: number;
  readonly resumedCount: number;
}

export interface DesktopCredentialMigrationCoordinatorOptions {
  readonly store: ApplicationConfigurationStore;
  readonly migrator: DesktopCredentialMigratorPort;
  readonly logger?: Logger;
}

export class DesktopCredentialMigrationCoordinator {
  readonly #store: ApplicationConfigurationStore;
  readonly #migrator: DesktopCredentialMigratorPort;
  readonly #logger: Logger;

  constructor(options: DesktopCredentialMigrationCoordinatorOptions) {
    this.#store = options.store;
    this.#migrator = options.migrator;
    this.#logger = (options.logger ?? noopLogger).child({
      component: "desktop_credential_migration_coordinator",
    });
  }

  async migrateKnownCredentials(): Promise<DesktopCredentialMigrationSummary> {
    this.#logger.info("desktop.credential_migration.started");
    const configuration = await this.#store.load();
    const references = configuration === undefined
      ? []
      : collectApplicationCredentialReferences(configuration);
    const results: CredentialMigrationResult[] = [];
    for (const reference of references) {
      results.push(await this.#migrator.migrate(reference));
    }
    const summary = summarize(results);
    this.#logger.info("desktop.credential_migration.completed", {
      referenceCount: summary.referenceCount,
      notRequiredCount: summary.notRequiredCount,
      alreadyMigratedCount: summary.alreadyMigratedCount,
      migratedCount: summary.migratedCount,
      resumedCount: summary.resumedCount,
    });
    return summary;
  }
}

export function collectApplicationCredentialReferences(
  configuration: ApplicationConfiguration,
): readonly CredentialReference[] {
  const references = new Map<string, CredentialReference>();
  const add = (reference: CredentialReference): void => {
    references.set(reference.id, reference);
  };
  if (configuration.network.proxyCredentialRef !== undefined) {
    add(new CredentialReference(configuration.network.proxyCredentialRef));
  }
  for (const connection of configuration.modelConnections) {
    if (connection.credentialRef !== undefined) add(connection.credentialRef);
    for (const reference of Object.values(connection.secretHeaderCredentialRefs)) {
      add(new CredentialReference(reference));
    }
  }
  return Object.freeze([...references.values()]);
}

function summarize(
  results: readonly CredentialMigrationResult[],
): DesktopCredentialMigrationSummary {
  return Object.freeze({
    referenceCount: results.length,
    notRequiredCount: count(results, CREDENTIAL_MIGRATION_OUTCOME.notRequired),
    alreadyMigratedCount: count(
      results,
      CREDENTIAL_MIGRATION_OUTCOME.alreadyMigrated,
    ),
    migratedCount: count(results, CREDENTIAL_MIGRATION_OUTCOME.migrated),
    resumedCount: count(results, CREDENTIAL_MIGRATION_OUTCOME.resumed),
  });
}

function count(
  results: readonly CredentialMigrationResult[],
  outcome: CredentialMigrationResult["outcome"],
): number {
  return results.filter((result) => result.outcome === outcome).length;
}
