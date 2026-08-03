/** Composes all accepted Novel Domain Operation handlers without provider details. */
import type {
  NovelEntityMutationContext,
  NovelOutlineMutationContext,
} from "../port/index.js";
import { registerNovelEntityOperationHandlers } from "./entity/index.js";
import { registerNovelOutlineOperationHandlers } from "./outline/index.js";
import { NovelOperationRegistry } from "./NovelOperationRegistry.js";

export type NovelMutationContext = NovelEntityMutationContext &
  NovelOutlineMutationContext;

export function createDefaultNovelOperationRegistry<
  TContext extends NovelMutationContext,
>(): NovelOperationRegistry<TContext> {
  const registry = new NovelOperationRegistry<TContext>();
  registerNovelEntityOperationHandlers(registry);
  registerNovelOutlineOperationHandlers(registry);
  return registry;
}
