/** Explicitly selects accepted canonical state or one durable Draft projection. */
import { captureNovelDraftSession, type NovelDraftSession } from "../draft/index.js";

export type NovelReadScope =
  | { readonly kind: "canonical" }
  | { readonly kind: "draft"; readonly session: NovelDraftSession };

export const canonicalNovelReadScope: NovelReadScope = Object.freeze({
  kind: "canonical",
});

export function draftNovelReadScope(
  session: NovelDraftSession,
): NovelReadScope {
  return Object.freeze({
    kind: "draft",
    session: captureNovelDraftSession(session),
  });
}

export function captureNovelReadScope(value: NovelReadScope): NovelReadScope {
  if (value?.kind === "canonical") return canonicalNovelReadScope;
  if (value?.kind === "draft") return draftNovelReadScope(value.session);
  throw new TypeError("Novel read scope is invalid");
}
