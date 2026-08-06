/** Explicit-scope authoritative Evidence queries and StoryUnit completion admission. */
import { captureStoryUnitId, type StoryUnitId } from "../identity/index.js";
import type {
  NovelEvidenceReadModel,
  NovelProjectionEvidenceQueryStore,
} from "../port/index.js";
import type {
  StoryUnitCharacterBinding,
  StoryUnitEntityChange,
  StoryUnitLocationBinding,
} from "../model/index.js";
import type { StoryUnitCompletionAdmission } from "../validation/index.js";
import { captureNovelReadScope, type NovelReadScope } from "./NovelReadScope.js";

export class NovelEvidenceQueryService {
  constructor(private readonly store: NovelProjectionEvidenceQueryStore) {}
  listCharacterBindings(scope: NovelReadScope): Promise<readonly NovelEvidenceReadModel<StoryUnitCharacterBinding>[]> {
    return this.store.listCharacterBindings(captureNovelReadScope(scope));
  }
  listLocationBindings(scope: NovelReadScope): Promise<readonly NovelEvidenceReadModel<StoryUnitLocationBinding>[]> {
    return this.store.listLocationBindings(captureNovelReadScope(scope));
  }
  listEntityChanges(scope: NovelReadScope): Promise<readonly NovelEvidenceReadModel<StoryUnitEntityChange>[]> {
    return this.store.listEntityChanges(captureNovelReadScope(scope));
  }
  evaluateCompletion(scope: NovelReadScope, storyUnitId: StoryUnitId): Promise<StoryUnitCompletionAdmission | undefined> {
    return this.store.evaluateCompletion(captureNovelReadScope(scope), captureStoryUnitId(storyUnitId));
  }
}
