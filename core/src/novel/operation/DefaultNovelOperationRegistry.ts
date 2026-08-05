/** Composes all accepted Novel Domain Operation handlers without provider details. */
import type {
  NovelEntityMutationContext,
  NovelOutlineMutationContext,
  NovelParagraphMutationContext,
  NovelProjectionEvidenceMutationContext,
  NovelPublicationMutationContext,
} from "../port/index.js";
import { registerNovelEntityOperationHandlers } from "./entity/index.js";
import { registerNovelProjectionEvidenceOperationHandlers } from "./evidence/index.js";
import { registerNovelOutlineOperationHandlers } from "./outline/index.js";
import { registerNovelParagraphOperationHandlers } from "./paragraph/index.js";
import { registerNovelPublicationOperationHandlers } from "./publication/index.js";
import { NovelOperationRegistry } from "./NovelOperationRegistry.js";

export type NovelMutationContext = NovelEntityMutationContext &
  NovelOutlineMutationContext &
  NovelPublicationMutationContext &
  NovelParagraphMutationContext &
  NovelProjectionEvidenceMutationContext;

export function createDefaultNovelOperationRegistry<
  TContext extends NovelMutationContext,
>(): NovelOperationRegistry<TContext> {
  const registry = new NovelOperationRegistry<TContext>();
  registerNovelEntityOperationHandlers(registry);
  registerNovelProjectionEvidenceOperationHandlers(registry);
  registerNovelOutlineOperationHandlers(registry);
  registerNovelPublicationOperationHandlers(registry);
  registerNovelParagraphOperationHandlers(registry);
  return registry;
}
