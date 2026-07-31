export class WorkspaceStoreIndexError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "WorkspaceStoreIndexError";
  }
}

export class WorkspaceStoreNotFoundError extends Error {
  constructor(public readonly workspaceId: string) {
    super(`Workspace store not found: ${workspaceId}`);
    this.name = "WorkspaceStoreNotFoundError";
  }
}

export class WorkspaceRootAlreadyBoundError extends Error {
  constructor(
    public readonly workspaceRoot: string,
    public readonly existingWorkspaceId: string,
  ) {
    super(`Workspace root is already bound to ${existingWorkspaceId}: ${workspaceRoot}`);
    this.name = "WorkspaceRootAlreadyBoundError";
  }
}

export class WorkspaceIndexLockTimeoutError extends Error {
  constructor(public readonly lockPath: string) {
    super(`Timed out waiting for workspace index lock: ${lockPath}`);
    this.name = "WorkspaceIndexLockTimeoutError";
  }
}
