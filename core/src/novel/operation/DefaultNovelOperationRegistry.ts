/** Composes all accepted Novel Domain Operation handlers without provider details. */
import type {
  NovelEntityMutationContext,
  NovelManuscriptMutationContext,
  NovelOutlineMutationContext,
  NovelProjectionEvidenceMutationContext,
  NovelPublicationMutationContext,
} from "../port/index.js";
import { registerNovelEntityOperationHandlers } from "./entity/index.js";
import { registerNovelManuscriptOperationHandlers } from "./manuscript/index.js";
import { registerNovelOutlineOperationHandlers } from "./outline/index.js";
import { registerNovelPublicationOperationHandlers } from "./publication/index.js";
import { NovelOperationRegistry } from "./NovelOperationRegistry.js";

export type NovelMutationContext = NovelEntityMutationContext &
  NovelOutlineMutationContext &
  NovelPublicationMutationContext &
  NovelManuscriptMutationContext &
  NovelProjectionEvidenceMutationContext;

export function createDefaultNovelOperationRegistry<
  TContext extends NovelMutationContext,
>(): NovelOperationRegistry<TContext> {
  const registry = new NovelOperationRegistry<TContext>();
  registerNovelEntityOperationHandlers(registry);
  registerNovelOutlineOperationHandlers(registry);
  registerNovelPublicationOperationHandlers(registry);
  registerNovelManuscriptOperationHandlers(registry);
  return registry;
}
