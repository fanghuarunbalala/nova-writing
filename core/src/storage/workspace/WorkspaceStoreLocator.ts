import type { WorkspaceStoreLocation } from "./WorkspaceStoreLocation.js";

export interface WorkspaceStoreLocator {
  resolve(workspaceRoot: string): Promise<WorkspaceStoreLocation>;

  getByWorkspaceId(workspaceId: string): Promise<WorkspaceStoreLocation | undefined>;

  rebind(workspaceId: string, newWorkspaceRoot: string): Promise<WorkspaceStoreLocation>;
}
