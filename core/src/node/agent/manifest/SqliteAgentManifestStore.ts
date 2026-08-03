/** Node SQLite adapter for the provider-neutral AgentManifestStore Port. */
import type { DatabaseSync } from "node:sqlite";
import {
  canonicalStringifyJson,
  type JsonValue,
} from "../../../event/index.js";
import {
  hydrateAgentManifest,
  type AgentManifest,
  type AgentManifestStore,
} from "../../../agent/manifest/index.js";
import { AgentManifestStoreError } from "../../../agent/manifest/index.js";
import { noopLogger, type Logger } from "../../../observability/index.js";

interface AgentManifestRow {
  manifest_id: string;
  manifest_digest: string;
  agent_type: string;
  definition_version: string;
  created_at: string;
  manifest_json: string;
}

export interface SqliteAgentManifestStoreOptions {
  readonly logger?: Logger;
}

export class SqliteAgentManifestStore implements AgentManifestStore {
  private readonly logger: Logger;

  constructor(
    private readonly database: DatabaseSync,
    private readonly ensureOpen: () => void,
    options: SqliteAgentManifestStoreOptions = {},
  ) {
    this.logger = (options.logger ?? noopLogger).child({
      component: "sqlite_agent_manifest_store",
    });
  }

  async save(manifest: AgentManifest): Promise<void> {
    this.ensureOpen();
    const snapshot = manifest.toSnapshot();
    const json = canonicalStringifyJson(snapshot as unknown as JsonValue);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.select(manifest.manifestId);
      if (existing !== undefined) {
        if (existing.manifest_digest !== manifest.manifestDigest) {
          throw new AgentManifestStoreError("manifest_conflict");
        }
        this.database.exec("COMMIT");
        return;
      }
      this.database
        .prepare(
          `INSERT INTO agent_manifests(
             manifest_id,
             manifest_digest,
             agent_type,
             definition_version,
             created_at,
             manifest_json
           ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          manifest.manifestId,
          manifest.manifestDigest,
          manifest.agentType,
          manifest.definitionVersion,
          manifest.createdAt,
          json,
        );
      this.database.exec("COMMIT");
      this.logger.info("agent_manifest.sqlite.saved", {
        agentType: manifest.agentType,
        definitionVersion: manifest.definitionVersion,
        manifestDigest: manifest.manifestDigest,
      });
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  async get(manifestId: string): Promise<AgentManifest | undefined> {
    this.ensureOpen();
    const row = this.select(manifestId);
    return row === undefined ? undefined : hydrateRow(row);
  }

  async getByAgent(
    agentType: string,
    definitionVersion: string,
  ): Promise<readonly AgentManifest[]> {
    this.ensureOpen();
    const rows = this.database
      .prepare(
        `SELECT * FROM agent_manifests
         WHERE agent_type = ? AND definition_version = ?
         ORDER BY created_at ASC, manifest_id ASC`,
      )
      .all(agentType, definitionVersion) as unknown as AgentManifestRow[];
    return Object.freeze(rows.map(hydrateRow));
  }

  private select(manifestId: string): AgentManifestRow | undefined {
    return this.database
      .prepare(
        `SELECT * FROM agent_manifests WHERE manifest_id = ?`,
      )
      .get(manifestId) as AgentManifestRow | undefined;
  }
}

function hydrateRow(row: AgentManifestRow): AgentManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.manifest_json);
  } catch {
    throw new TypeError("Stored Agent Manifest JSON is invalid");
  }
  if (
    !isRecord(parsed) ||
    parsed.manifestId !== row.manifest_id ||
    parsed.manifestDigest !== row.manifest_digest ||
    parsed.agentType !== row.agent_type ||
    parsed.definitionVersion !== row.definition_version ||
    parsed.createdAt !== row.created_at
  ) {
    throw new TypeError("Stored Agent Manifest identity is inconsistent");
  }
  return hydrateAgentManifest(parsed as never);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
