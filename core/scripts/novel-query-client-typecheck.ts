/** Compile-only proof for the grouped platform-neutral Novel query client API. */
import {
  DefaultNovelApiClient,
  canonicalNovelQueryScope,
  captureCharacterId,
  captureLocationId,
  captureParagraphId,
  captureStoryUnitId,
  type ApiTransport,
} from "../src/index.js";

declare const transport: ApiTransport;

const api = new DefaultNovelApiClient({ transport });
void api.novel.overview.get(canonicalNovelQueryScope);
void api.novel.outline.get(canonicalNovelQueryScope);
void api.novel.outline.getStoryUnit(
  canonicalNovelQueryScope,
  captureStoryUnitId("story_unit"),
);
void api.novel.characters.list(canonicalNovelQueryScope);
void api.novel.characters.get(
  canonicalNovelQueryScope,
  captureCharacterId("character"),
);
void api.novel.locations.list(canonicalNovelQueryScope);
void api.novel.locations.get(
  canonicalNovelQueryScope,
  captureLocationId("location"),
);
void api.novel.paragraphs.getCatalog(canonicalNovelQueryScope);
void api.novel.paragraphs.get(
  canonicalNovelQueryScope,
  captureParagraphId("paragraph"),
);
void api.novel.publication.getCatalog(canonicalNovelQueryScope);
