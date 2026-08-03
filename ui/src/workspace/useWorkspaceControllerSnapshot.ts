/** React external-store binding for one WorkspaceController. */
import { useSyncExternalStore } from "react";
import {
  type WorkspaceController,
  type WorkspaceControllerSnapshot,
} from "./WorkspaceController.js";

export function useWorkspaceControllerSnapshot(
  controller: WorkspaceController,
): WorkspaceControllerSnapshot {
  return useSyncExternalStore(
    (listener) => controller.subscribe(listener),
    () => controller.getSnapshot(),
    () => controller.getSnapshot(),
  );
}
