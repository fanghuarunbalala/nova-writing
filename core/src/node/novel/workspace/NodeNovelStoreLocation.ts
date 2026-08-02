/** Node-only physical locations for canonical, staging, history, and Artifact stores. */
export interface NodeNovelStoreLocation {
  readonly workspaceId: string;
  readonly canonicalDatabasePath: string;
  readonly stagingDir: string;
  readonly historyDir: string;
  readonly commitHistoryDir: string;
  readonly artifactDir: string;
}
