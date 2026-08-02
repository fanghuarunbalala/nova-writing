/** Derives and initializes Novel-owned paths inside an existing Workspace Store. */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { captureNovelWorkspaceId } from "../../../novel/index.js";
import type { WorkspaceStoreLocation } from "../../../storage/index.js";
import type { NodeNovelStoreLocation } from "./NodeNovelStoreLocation.js";

export class NodeNovelStoreLocator {
  async resolve(workspace: WorkspaceStoreLocation): Promise<NodeNovelStoreLocation> {
    const workspaceId = captureNovelWorkspaceId(workspace.workspaceId);
    const stagingDir = join(workspace.storeDir, "novel-staging");
    const historyDir = join(workspace.storeDir, "novel-history");
    const commitHistoryDir = join(historyDir, "commits");
    const artifactDir = join(workspace.storeDir, "novel-artifacts");

    await Promise.all([
      mkdir(stagingDir, { recursive: true }),
      mkdir(commitHistoryDir, { recursive: true }),
      mkdir(artifactDir, { recursive: true }),
    ]);

    return Object.freeze({
      workspaceId,
      canonicalDatabasePath: join(workspace.storeDir, "novel.sqlite"),
      stagingDir,
      historyDir,
      commitHistoryDir,
      artifactDir,
    });
  }
}
