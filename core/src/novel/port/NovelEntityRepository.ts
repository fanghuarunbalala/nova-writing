/** Repository contracts shared by Character and Location Operation handlers. */
import type { Character, Location } from "../model/index.js";
import type { CharacterId, LocationId } from "../identity/index.js";
import type { NovelEntityVersion } from "../version/index.js";
import type { NovelReadScope } from "../query/index.js";

export interface NovelMutableEntityRepository<TEntity, TId> {
  get(id: TId): TEntity | undefined;
  insert(entity: TEntity): boolean;
  replace(entity: TEntity, expectedVersion: NovelEntityVersion): boolean;
  delete(id: TId, expectedVersion: NovelEntityVersion): boolean;
}

export interface NovelEntityMutationContext {
  readonly characters: NovelMutableEntityRepository<Character, CharacterId>;
  readonly locations: NovelMutableEntityRepository<Location, LocationId>;
}

export interface NovelEntityQueryStore {
  getCharacter(
    scope: NovelReadScope,
    id: CharacterId,
  ): Promise<Character | undefined>;
  listCharacters(scope: NovelReadScope): Promise<readonly Character[]>;
  getLocation(
    scope: NovelReadScope,
    id: LocationId,
  ): Promise<Location | undefined>;
  listLocations(scope: NovelReadScope): Promise<readonly Location[]>;
}
