/** Generates opaque equality-only Novel revisions without exposing their format. */
import { captureNovelRevision, type NovelRevision } from "../version/index.js";

export interface NovelRevisionFactory {
  createRevision(): NovelRevision;
}

export class RandomNovelRevisionFactory implements NovelRevisionFactory {
  createRevision(): NovelRevision {
    return captureNovelRevision(
      `revision_${globalThis.crypto.randomUUID().replaceAll("-", "")}`,
    );
  }
}
