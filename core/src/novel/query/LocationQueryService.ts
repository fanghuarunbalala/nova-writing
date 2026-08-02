/** Explicit-scope Location query service with no implicit Draft selection. */
import { captureLocationId, type LocationId } from "../identity/index.js";
import type { Location } from "../model/index.js";
import type { NovelEntityQueryStore } from "../port/index.js";
import { captureNovelReadScope, type NovelReadScope } from "./NovelReadScope.js";

export class LocationQueryService {
  constructor(private readonly store: NovelEntityQueryStore) {}

  get(
    scope: NovelReadScope,
    id: LocationId,
  ): Promise<Location | undefined> {
    return this.store.getLocation(
      captureNovelReadScope(scope),
      captureLocationId(id),
    );
  }

  list(scope: NovelReadScope): Promise<readonly Location[]> {
    return this.store.listLocations(captureNovelReadScope(scope));
  }
}
