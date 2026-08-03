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

export interface NovelMutableProjectionEvidenceRepository {
  listCharacterBindings(): readonly StoryUnitCharacterBinding[];
  putCharacterBinding(binding: StoryUnitCharacterBinding): void;
  deleteCharacterBinding(storyUnitId: StoryUnitId, characterId: CharacterId): boolean;
  listLocationBindings(): readonly StoryUnitLocationBinding[];
  putLocationBinding(binding: StoryUnitLocationBinding): void;
  deleteLocationBinding(storyUnitId: StoryUnitId, locationId: LocationId): boolean;
  listEntityChanges(): readonly StoryUnitEntityChange[];
  putEntityChange(change: StoryUnitEntityChange): void;
  deleteEntityChange(id: StoryUnitEntityChangeId): boolean;
  listRealizations(): readonly StoryUnitRealization[];
  putRealization(realization: StoryUnitRealization): void;
  deleteRealization(storyUnitId: StoryUnitId): boolean;
}

export interface NovelProjectionEvidenceMutationContext {
  readonly projectionEvidence: NovelMutableProjectionEvidenceRepository;
}
