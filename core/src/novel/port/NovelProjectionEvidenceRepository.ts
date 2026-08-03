/** Transaction-local authoritative evidence required to rebuild Novel projections. */
import type {
  CharacterId,
  LocationId,
  StoryUnitEntityChangeId,
  StoryUnitId,
} from "../identity/index.js";
import type {
  StoryUnitCharacterBinding,
  StoryUnitEntityChange,
  StoryUnitLocationBinding,
  StoryUnitRealization,
} from "../model/index.js";
import type { NovelReadScope } from "../query/index.js";
import type { StoryUnitCompletionAdmission } from "../validation/index.js";

export interface NovelMutableProjectionEvidenceRepository {
  listCharacterBindings(): readonly StoryUnitCharacterBinding[];
  getCharacterBinding(
    storyUnitId: StoryUnitId,
    characterId: CharacterId,
  ): StoryUnitCharacterBinding | undefined;
  getCharacterBindingDigest(storyUnitId: StoryUnitId, characterId: CharacterId): string | undefined;
  putCharacterBinding(binding: StoryUnitCharacterBinding): void;
  deleteCharacterBinding(storyUnitId: StoryUnitId, characterId: CharacterId): boolean;
  listLocationBindings(): readonly StoryUnitLocationBinding[];
  getLocationBinding(
    storyUnitId: StoryUnitId,
    locationId: LocationId,
  ): StoryUnitLocationBinding | undefined;
  getLocationBindingDigest(storyUnitId: StoryUnitId, locationId: LocationId): string | undefined;
  putLocationBinding(binding: StoryUnitLocationBinding): void;
  deleteLocationBinding(storyUnitId: StoryUnitId, locationId: LocationId): boolean;
  listEntityChanges(): readonly StoryUnitEntityChange[];
  getEntityChange(id: StoryUnitEntityChangeId): StoryUnitEntityChange | undefined;
  getEntityChangeDigest(id: StoryUnitEntityChangeId): string | undefined;
  putEntityChange(change: StoryUnitEntityChange): void;
  deleteEntityChange(id: StoryUnitEntityChangeId): boolean;
  listRealizations(): readonly StoryUnitRealization[];
  getRealization(storyUnitId: StoryUnitId): StoryUnitRealization | undefined;
  getRealizationDigest(storyUnitId: StoryUnitId): string | undefined;
  putRealization(realization: StoryUnitRealization): void;
  deleteRealization(storyUnitId: StoryUnitId): boolean;
  hasStoryUnit(storyUnitId: StoryUnitId): boolean;
  hasCharacter(characterId: CharacterId): boolean;
  hasLocation(locationId: LocationId): boolean;
}

export interface NovelProjectionEvidenceMutationContext {
  readonly projectionEvidence: NovelMutableProjectionEvidenceRepository;
}

export interface NovelEvidenceReadModel<T> {
  readonly value: T;
  readonly recordDigest: string;
}

export interface NovelProjectionEvidenceQueryStore {
  listCharacterBindings(scope: NovelReadScope): Promise<readonly NovelEvidenceReadModel<StoryUnitCharacterBinding>[]>;
  listLocationBindings(scope: NovelReadScope): Promise<readonly NovelEvidenceReadModel<StoryUnitLocationBinding>[]>;
  listEntityChanges(scope: NovelReadScope): Promise<readonly NovelEvidenceReadModel<StoryUnitEntityChange>[]>;
  listRealizations(scope: NovelReadScope): Promise<readonly NovelEvidenceReadModel<StoryUnitRealization>[]>;
  getRealization(
    scope: NovelReadScope,
    storyUnitId: StoryUnitId,
  ): Promise<NovelEvidenceReadModel<StoryUnitRealization> | undefined>;
  evaluateCompletion(
    scope: NovelReadScope,
    storyUnitId: StoryUnitId,
  ): Promise<StoryUnitCompletionAdmission | undefined>;
}
