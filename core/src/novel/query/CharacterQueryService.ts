/** Explicit-scope Character query service with no implicit Draft selection. */
import { captureCharacterId, type CharacterId } from "../identity/index.js";
import type { Character } from "../model/index.js";
import type { NovelEntityQueryStore } from "../port/index.js";
import { captureNovelReadScope, type NovelReadScope } from "./NovelReadScope.js";

export class CharacterQueryService {
  constructor(private readonly store: NovelEntityQueryStore) {}

  get(
    scope: NovelReadScope,
    id: CharacterId,
  ): Promise<Character | undefined> {
    return this.store.getCharacter(
      captureNovelReadScope(scope),
      captureCharacterId(id),
    );
  }

  list(scope: NovelReadScope): Promise<readonly Character[]> {
    return this.store.listCharacters(captureNovelReadScope(scope));
  }
}
