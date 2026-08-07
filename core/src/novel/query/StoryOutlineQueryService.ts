/** Explicit-scope Story Outline queries with immutable optimistic digest models. */
import { captureStoryUnitId, type StoryUnitId } from "../identity/index.js";
import type { NovelEntityVersion } from "../version/index.js";
import { StoryOutlineTree, type StoryOutline } from "../model/index.js";
import type {
  LeafStoryUnitPlanReadModel,
  NovelOutlineQueryStore,
  StoryUnitReadModel,
} from "../port/index.js";
import { captureNovelReadScope, type NovelReadScope } from "./NovelReadScope.js";

export class StoryOutlineQueryService {
  constructor(private readonly store: NovelOutlineQueryStore) {}

  getOutline(scope: NovelReadScope): Promise<StoryOutline | undefined> {
    return this.store.getStoryOutline(captureNovelReadScope(scope));
  }

  async getTree(scope: NovelReadScope): Promise<StoryOutlineTree | undefined> {
    const snapshot = await this.store.getStoryOutlineTreeSnapshot(
      captureNovelReadScope(scope),
    );
    return snapshot === undefined ? undefined : new StoryOutlineTree(snapshot);
  }

  async getStoryUnit(
    scope: NovelReadScope,
    id: StoryUnitId,
  ): Promise<StoryUnitReadModel | undefined> {
    const value = await this.store.getStoryUnit(
      captureNovelReadScope(scope),
      captureStoryUnitId(id),
    );
    return value === undefined ? undefined : captureStoryUnitReadModel(value);
  }

  getStoryUnitVersion(
    scope: NovelReadScope,
    id: StoryUnitId,
  ): Promise<NovelEntityVersion | undefined> {
    return this.store.getStoryUnitVersion(
      captureNovelReadScope(scope),
      captureStoryUnitId(id),
    );
  }

  async getLeafStoryUnitPlan(
    scope: NovelReadScope,
    id: StoryUnitId,
  ): Promise<LeafStoryUnitPlanReadModel | undefined> {
    const value = await this.store.getLeafStoryUnitPlan(
      captureNovelReadScope(scope),
      captureStoryUnitId(id),
    );
    return value === undefined ? undefined : captureLeafPlanReadModel(value);
  }
}

function captureStoryUnitReadModel(value: StoryUnitReadModel): StoryUnitReadModel {
  return Object.freeze({
    unit: value.unit,
    contentDigest: captureDigest(value.contentDigest),
    parentDigest: captureDigest(value.parentDigest),
    orderDigest: captureDigest(value.orderDigest),
  });
}

function captureLeafPlanReadModel(
  value: LeafStoryUnitPlanReadModel,
): LeafStoryUnitPlanReadModel {
  return Object.freeze({
    plan: value.plan,
    planDigest: captureDigest(value.planDigest),
  });
}

function captureDigest(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new TypeError("Novel Outline digest is invalid");
  }
  return value;
}
