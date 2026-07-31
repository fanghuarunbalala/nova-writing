export interface WorkspaceStoreNamingInput {
  canonicalWorkspaceRoot: string;
  workspaceId: string;
}

export interface WorkspaceStoreNamingStrategy {
  createStoreDirName(input: WorkspaceStoreNamingInput): string;
}
