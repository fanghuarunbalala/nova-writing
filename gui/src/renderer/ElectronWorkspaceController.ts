/** Adapts the optional Preload Workspace capability to the shared UI controller. */
import { ApiTransportError, type Logger } from "@novel/core";
import {
  WorkspaceController,
  type WorkspaceReferenceView,
} from "@novel/ui";
import type {
  ElectronBridgeResult,
  ElectronPreloadBridge,
} from "../shared/index.js";

export function createElectronWorkspaceController(
  bridge: ElectronPreloadBridge,
  logger: Logger,
): WorkspaceController | undefined {
  const workspaces = bridge.workspaces;
  if (workspaces === undefined) return undefined;
  const controller = new WorkspaceController({
    logger,
    picker: {
      pickWorkspace: async () => unwrap(await workspaces.select()),
    },
    sessions: {
      listRecent: async () => unwrap(await workspaces.listRecent()),
      open: async (reference: WorkspaceReferenceView) =>
        unwrap(await workspaces.open(reference)),
      close: async () => {
        unwrap(await workspaces.close());
      },
    },
  });
  // 主进程 workspace 已打开推送：renderer 错过 open 响应（重启/自动打开）时同步。
  workspaces.onWorkspaceOpened((session) => controller.notifyOpened(session));
  return controller;
}

function unwrap<TValue>(result: ElectronBridgeResult<TValue>): TValue {
  if (result.ok) return result.value;
  throw new ApiTransportError(
    result.error.code,
    result.error.retryable,
    "Electron Workspace operation failed",
  );
}
