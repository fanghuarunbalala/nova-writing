/** Typed lifecycle errors for Node Message projection integration. */
export class SqliteWorkspaceStoreClosingError extends Error {
  readonly code = "SQLITE_WORKSPACE_STORE_CLOSING";

  constructor() {
    super("SqliteWorkspaceStore is closing");
    this.name = "SqliteWorkspaceStoreClosingError";
  }
}

export class SqliteWorkspaceStoreClosedError extends Error {
  readonly code = "SQLITE_WORKSPACE_STORE_CLOSED";

  constructor() {
    super("SqliteWorkspaceStore is closed");
    this.name = "SqliteWorkspaceStoreClosedError";
  }
}
