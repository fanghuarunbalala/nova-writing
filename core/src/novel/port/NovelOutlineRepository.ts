/** Synchronous transaction-local repositories used by deterministic Outline Operations. */
import type {
  CharacterId,
  LocationId,
  NovelId,
  StoryEntityId,
  StoryOutlineId,
  StoryUnitId,
} from "../identity/index.js";
import type {
  LeafStoryUnitPlan,
  OrderKey,
  StoryOutline,
  StoryUnit,
} from "../model/index.js";

export type StoryUnitDigestField = "content" | "parentId" | "orderKey";

export interface NovelMutableOutlineRepository {
  getOutline(id: StoryOutlineId): StoryOutline | undefined;
  findOutlineByNovelId(novelId: NovelId): StoryOutline | undefined;
  insertOutline(outline: StoryOutline): boolean;
  getStoryUnit(id: StoryUnitId): StoryUnit | undefined;
  listStoryUnits(outlineId: StoryOutlineId): readonly StoryUnit[];
  listStoryUnitChildren(parentId: StoryUnitId): readonly StoryUnit[];
  findStoryUnitAt(
    outlineId: StoryOutlineId,
    parentId: StoryUnitId | undefined,
    orderKey: OrderKey,
  ): StoryUnit | undefined;
  isStoryUnitDescendant(
    ancestorId: StoryUnitId,
    candidateDescendantId: StoryUnitId,
  ): boolean;
  getStoryUnitDigest(
    id: StoryUnitId,
    field: StoryUnitDigestField,
  ): string | undefined;
  insertStoryUnit(unit: StoryUnit): boolean;
  replaceStoryUnit(unit: StoryUnit): boolean;
  deleteStoryUnit(id: StoryUnitId): boolean;
  getLeafStoryUnitPlan(id: StoryUnitId): LeafStoryUnitPlan | undefined;
  getLeafStoryUnitPlanDigest(id: StoryUnitId): string | undefined;
  replaceLeafStoryUnitPlan(plan: LeafStoryUnitPlan): boolean;
  clearLeafStoryUnitPlan(id: StoryUnitId): boolean;
  hasCharacter(id: CharacterId): boolean;
  hasLocation(id: LocationId): boolean;
  hasStoryEntity(id: StoryEntityId): boolean;
}

export interface NovelOutlineMutationContext {
  readonly outline: NovelMutableOutlineRepository;
}
