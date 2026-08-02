/** Projects effective StoryUnit progress from active leaf descendants. */
import type { StoryUnitId } from "../../identity/index.js";
import type { StoryUnitRealizationStatus } from "./StoryUnitStatus.js";

export interface StoryUnitProgressProjection {
  readonly storyUnitId: StoryUnitId;
  readonly effectiveStatus: StoryUnitRealizationStatus;
  readonly isBlocked: boolean;
  readonly isDirectlyBlocked: boolean;
  readonly isBlockedByAncestor: boolean;
  readonly blockedLeafCount: number;
  readonly completedLeafCount: number;
  readonly totalLeafCount: number;
}
