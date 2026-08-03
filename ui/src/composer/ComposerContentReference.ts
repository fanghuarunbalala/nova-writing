/** Immutable UI-local reference descriptor; it is not an InputEvent wire payload. */
import {
  captureInspectorTarget,
  type InspectorTarget,
} from "../inspector/index.js";

export type ComposerContentReferenceKind =
  | "story-unit"
  | "manuscript-block"
  | "character"
  | "location"
  | "novel-operation"
  | "schedule";

export interface ComposerContentReference {
  readonly key: string;
  readonly kind: ComposerContentReferenceKind;
  readonly label: string;
  readonly target: InspectorTarget;
}

const REFERENCE_KINDS = new Set<ComposerContentReferenceKind>([
  "story-unit",
  "manuscript-block",
  "character",
  "location",
  "novel-operation",
  "schedule",
]);

export function captureComposerContentReference(
  reference: ComposerContentReference,
): ComposerContentReference {
  if (!REFERENCE_KINDS.has(reference.kind)) {
    throw new TypeError("Composer reference kind is invalid");
  }
  return Object.freeze({
    key: requireNonBlank(reference.key, "Composer reference key"),
    kind: reference.kind,
    label: requireNonBlank(reference.label, "Composer reference label"),
    target: captureInspectorTarget(reference.target),
  });
}

export function sameComposerContentReference(
  left: ComposerContentReference,
  right: ComposerContentReference,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function requireNonBlank(value: string, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must not be blank`);
  }
  return value;
}
