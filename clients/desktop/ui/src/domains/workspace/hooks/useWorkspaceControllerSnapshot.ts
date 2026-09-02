/**
 * useWorkspaceControllerSnapshot
 *
 * 通过 adapter 订阅 workspace 控制器快照。
 */
import { useExternalStore } from "../../../shared/state/useExternalStore.js";
import type { WorkspaceControllerAdapter } from "../store/WorkspaceControllerAdapter.js";

export function useWorkspaceControllerSnapshot(
  adapter: WorkspaceControllerAdapter,
): ReturnType<WorkspaceControllerAdapter["getSnapshot"]> {
  return useExternalStore(adapter);
}
