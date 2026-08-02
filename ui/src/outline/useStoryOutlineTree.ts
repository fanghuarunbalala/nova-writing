/** React external-store binding for a StoryOutlineTreeController. */
import { useCallback, useSyncExternalStore } from "react";
import type {
  StoryOutlineTreeController,
  StoryOutlineTreeSnapshot,
} from "./StoryOutlineTreeController.js";

export function useStoryOutlineTree(
  controller: StoryOutlineTreeController,
): StoryOutlineTreeSnapshot {
  const subscribe = useCallback(
    (listener: () => void) => controller.subscribe(listener),
    [controller],
  );
  const getSnapshot = useCallback(() => controller.getSnapshot(), [controller]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
