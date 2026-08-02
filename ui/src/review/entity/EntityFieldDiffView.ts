/** Validated field-oriented Diff views shared by Character and Location reviewers. */
export type EntityFieldDiffKind = "unchanged" | "added" | "removed" | "modified";

export type EntityFieldValueView =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "list"; readonly items: readonly string[] };

export interface EntityFieldDiffView {
  readonly fieldId: string;
  readonly label: string;
  readonly kind: EntityFieldDiffKind;
  readonly before?: EntityFieldValueView;
  readonly after?: EntityFieldValueView;
}

export interface EntityProjectionEvidenceView {
  readonly evidenceId: string;
  readonly mode: "confirmed" | "planned";
  readonly title: string;
  readonly summary?: string;
  readonly sourceStoryUnitIds: readonly string[];
}

export interface EntityFieldReviewView {
  readonly entityId: string;
  readonly entityName: string;
  readonly fields: readonly EntityFieldDiffView[];
  readonly evidence?: readonly EntityProjectionEvidenceView[];
}

const DIFF_KINDS = new Set<EntityFieldDiffKind>([
  "unchanged",
  "added",
  "removed",
  "modified",
]);

export function captureEntityFieldReviewView(
  view: EntityFieldReviewView,
): EntityFieldReviewView {
  const fields = view.fields.map(captureField);
  if (new Set(fields.map((field) => field.fieldId)).size !== fields.length) {
    throw new TypeError("Entity Review field ids must be unique");
  }
  const evidence = (view.evidence ?? []).map(captureEvidence);
  if (new Set(evidence.map((item) => item.evidenceId)).size !== evidence.length) {
    throw new TypeError("Entity Review evidence ids must be unique");
  }
  return Object.freeze({
    entityId: captureToken(view.entityId, "Entity Review id"),
    entityName: captureText(view.entityName, "Entity Review name", 500),
    fields: Object.freeze(fields),
    ...(evidence.length > 0 ? { evidence: Object.freeze(evidence) } : {}),
  });
}

function captureField(field: EntityFieldDiffView): EntityFieldDiffView {
  if (!DIFF_KINDS.has(field.kind)) {
    throw new TypeError("Entity Review field Diff kind is invalid");
  }
  const before = field.before === undefined ? undefined : captureValue(field.before);
  const after = field.after === undefined ? undefined : captureValue(field.after);
  if (
    (field.kind === "added" && (before !== undefined || after === undefined)) ||
    (field.kind === "removed" && (before === undefined || after !== undefined)) ||
    (field.kind === "modified" && (before === undefined || after === undefined)) ||
    (field.kind === "unchanged" && (before === undefined || after !== undefined))
  ) {
    throw new TypeError("Entity Review field Diff values are inconsistent");
  }
  return Object.freeze({
    fieldId: captureToken(field.fieldId, "Entity Review field id"),
    label: captureText(field.label, "Entity Review field label", 500),
    kind: field.kind,
    ...(before !== undefined ? { before } : {}),
    ...(after !== undefined ? { after } : {}),
  });
}

function captureValue(value: EntityFieldValueView): EntityFieldValueView {
  if (value.kind === "text") {
    return Object.freeze({
      kind: "text",
      text: captureText(value.text, "Entity Review field text", 50_000),
    });
  }
  if (value.kind === "list") {
    const items = value.items.map((item) =>
      captureText(item, "Entity Review field list item", 2_000),
    );
    return Object.freeze({ kind: "list", items: Object.freeze(items) });
  }
  throw new TypeError("Entity Review field value is invalid");
}

function captureEvidence(
  evidence: EntityProjectionEvidenceView,
): EntityProjectionEvidenceView {
  if (evidence.mode !== "confirmed" && evidence.mode !== "planned") {
    throw new TypeError("Entity Review evidence mode is invalid");
  }
  const sourceStoryUnitIds = evidence.sourceStoryUnitIds.map((id) =>
    captureToken(id, "Evidence StoryUnit id"),
  );
  if (new Set(sourceStoryUnitIds).size !== sourceStoryUnitIds.length) {
    throw new TypeError("Evidence StoryUnit ids must be unique");
  }
  return Object.freeze({
    evidenceId: captureToken(evidence.evidenceId, "Entity Review evidence id"),
    mode: evidence.mode,
    title: captureText(evidence.title, "Entity Review evidence title", 500),
    ...(evidence.summary !== undefined
      ? { summary: captureText(evidence.summary, "Entity Review evidence summary", 10_000) }
      : {}),
    sourceStoryUnitIds: Object.freeze(sourceStoryUnitIds),
  });
}

function captureToken(value: string, label: string): string {
  return captureText(value, label, 200);
}

function captureText(value: string, label: string, maximumLength: number): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > maximumLength ||
    /\u0000/u.test(value)
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}
