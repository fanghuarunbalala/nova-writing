/** Field Diff and repairable projection-evidence presentation primitives. */
import { useState } from "react";
import {
  ReferenceInConversationButton,
  type ComposerContentReference,
} from "../../composer/index.js";
import type {
  EntityFieldDiffView,
  EntityFieldReviewView,
  EntityFieldValueView,
} from "./EntityFieldDiffView.js";

export type EntityFieldReferenceResolver = (
  field: EntityFieldDiffView,
  view: EntityFieldReviewView,
) => ComposerContentReference | undefined;

export interface EntityFieldDiffListProps {
  readonly view: EntityFieldReviewView;
  readonly referenceForField?: EntityFieldReferenceResolver;
}

export function EntityFieldDiffList({
  view,
  referenceForField,
}: EntityFieldDiffListProps) {
  const [selectedFieldId, setSelectedFieldId] = useState<string | undefined>();
  const selectedField = selectedFieldId === undefined
    ? undefined
    : view.fields.find((field) => field.fieldId === selectedFieldId);
  const selectedReference =
    selectedField === undefined || referenceForField === undefined
      ? undefined
      : referenceForField(selectedField, view);
  return (
    <div className="novel-entity-review-body">
      {selectedReference !== undefined ? (
        <div className="novel-entity-field-actions">
          <span>{selectedField?.label ?? "已选择字段"}</span>
          <ReferenceInConversationButton reference={selectedReference} />
        </div>
      ) : null}
      <section className="novel-entity-field-list" aria-label="字段变更">
        {view.fields.length === 0 ? (
          <p className="novel-entity-review-empty">没有字段变更。</p>
        ) : (
          view.fields.map((field) => (
            <EntityFieldDiff
              key={field.fieldId}
              field={field}
              selected={field.fieldId === selectedFieldId}
              onSelect={() => setSelectedFieldId(field.fieldId)}
            />
          ))
        )}
      </section>
      {view.evidence !== undefined ? (
        <section className="novel-entity-evidence" aria-label="状态投影证据">
          <h4>状态投影证据</h4>
          <p>以下内容是可重建的投影视图，不是独立 Novel 真相。</p>
          {view.evidence.map((evidence) => (
            <article key={evidence.evidenceId} data-evidence-mode={evidence.mode}>
              <header>
                <strong>{evidence.title}</strong>
                <span>{evidence.mode === "confirmed" ? "已确认" : "规划中"}</span>
              </header>
              {evidence.summary !== undefined ? <p>{evidence.summary}</p> : null}
              <small>来源 StoryUnit：{evidence.sourceStoryUnitIds.length}</small>
            </article>
          ))}
        </section>
      ) : null}
    </div>
  );
}

function EntityFieldDiff({
  field,
  selected,
  onSelect,
}: {
  readonly field: EntityFieldDiffView;
  readonly selected: boolean;
  readonly onSelect: () => void;
}) {
  return (
    <article
      className="novel-entity-field-diff"
      data-diff-kind={field.kind}
      data-selected={selected}
      data-field-id={field.fieldId}
      tabIndex={0}
      onClick={onSelect}
      onFocus={onSelect}
    >
      <header>
        <h4>{field.label}</h4>
        <span>{diffLabel(field.kind)}</span>
      </header>
      {field.kind === "modified" ? (
        <div className="novel-entity-field-replacement">
          <FieldValue value={field.before} tone="removed" label="修改前" />
          <FieldValue value={field.after} tone="added" label="修改后" />
        </div>
      ) : (
        <FieldValue
          value={field.kind === "added" ? field.after : field.before}
          tone={field.kind}
        />
      )}
    </article>
  );
}

function FieldValue({
  value,
  tone,
  label,
}: {
  readonly value: EntityFieldValueView | undefined;
  readonly tone: "unchanged" | "added" | "removed";
  readonly label?: string;
}) {
  if (value === undefined) return null;
  return (
    <div className="novel-entity-field-value" data-value-tone={tone}>
      {label !== undefined ? <span>{label}</span> : null}
      {value.kind === "text" ? (
        <p>{value.text}</p>
      ) : (
        <ul>
          {value.items.map((item, itemIndex) => (
            <li key={`${itemIndex}:${item}`}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function diffLabel(kind: EntityFieldDiffView["kind"]): string {
  switch (kind) {
    case "unchanged":
      return "未变化";
    case "added":
      return "新增";
    case "removed":
      return "删除";
    case "modified":
      return "修改";
  }
}
