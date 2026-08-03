/** Async explicit-scope reads for Story Outline state and optimistic digests. */
import type { StoryUnitId } from "../identity/index.js";
import type {
  LeafStoryUnitPlan,
  StoryOutline,
  StoryOutlineTreeSnapshot,
  StoryUnit,
} from "../model/index.js";
import type { NovelReadScope } from "../query/index.js";

export interface StoryUnitReadModel {
  readonly unit: StoryUnit;
  readonly contentDigest: string;
  readonly parentDigest: string;
  readonly orderDigest: string;
}

export interface LeafStoryUnitPlanReadModel {
  readonly plan: LeafStoryUnitPlan;
  readonly planDigest: string;
}

export interface NovelOutlineQueryStore {
  getStoryOutline(scope: NovelReadScope): Promise<StoryOutline | undefined>;
  getStoryOutlineTreeSnapshot(
    scope: NovelReadScope,
  ): Promise<StoryOutlineTreeSnapshot | undefined>;
  listStoryUnits(scope: NovelReadScope): Promise<readonly StoryUnit[]>;
  getStoryUnit(
    scope: NovelReadScope,
    id: StoryUnitId,
  ): Promise<StoryUnitReadModel | undefined>;
  getLeafStoryUnitPlan(
    scope: NovelReadScope,
    id: StoryUnitId,
  ): Promise<LeafStoryUnitPlanReadModel | undefined>;
}
