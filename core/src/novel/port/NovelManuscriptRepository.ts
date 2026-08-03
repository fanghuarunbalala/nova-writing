/** Synchronous transaction-local repository used by deterministic Manuscript Operations. */
import type {
  ManuscriptBlockId,
  ManuscriptId,
  PublicationChapterId,
} from "../identity/index.js";
import type {
  Manuscript,
  ManuscriptAnchor,
  ManuscriptAnchorRedirect,
  ManuscriptBlockTombstone,
  OrderKey,
  ParagraphBlock,
} from "../model/index.js";

export type ManuscriptBlockDigestField = "text" | "chapterId" | "orderKey";

export interface NovelMutableManuscriptRepository {
  getManuscript(id: ManuscriptId): Manuscript | undefined;
  getBlock(id: ManuscriptBlockId): ParagraphBlock | undefined;
  getBlockDigest(
    id: ManuscriptBlockId,
    field: ManuscriptBlockDigestField,
  ): string | undefined;
  listBlocksInChapter(
    manuscriptId: ManuscriptId,
    chapterId: PublicationChapterId,
  ): readonly ParagraphBlock[];
  findBlockAt(
    manuscriptId: ManuscriptId,
    chapterId: PublicationChapterId,
    orderKey: OrderKey,
  ): ParagraphBlock | undefined;
  hasPublicationChapter(chapterId: PublicationChapterId): boolean;
  insertBlock(block: ParagraphBlock): boolean;
  replaceBlock(block: ParagraphBlock): boolean;
  deleteBlock(id: ManuscriptBlockId): boolean;
  getTombstone(id: ManuscriptBlockId): ManuscriptBlockTombstone | undefined;
  insertTombstone(tombstone: ManuscriptBlockTombstone): boolean;
  getAnchorRedirect(
    source: ManuscriptAnchor,
  ): ManuscriptAnchorRedirect | undefined;
  insertAnchorRedirect(redirect: ManuscriptAnchorRedirect): boolean;
}

export interface NovelManuscriptMutationContext {
  readonly manuscript: NovelMutableManuscriptRepository;
}
