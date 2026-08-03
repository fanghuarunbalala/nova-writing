/** Accessible structured-reference chips backed only by local Composer state. */
import type { ComposerContentReference } from "./ComposerContentReference.js";

export interface ComposerReferenceChipsProps {
  readonly references: readonly ComposerContentReference[];
  readonly disabled?: boolean;
  readonly onOpen?: (reference: ComposerContentReference) => void;
  readonly onRemove: (reference: ComposerContentReference) => void;
}

export function ComposerReferenceChips({
  references,
  disabled = false,
  onOpen,
  onRemove,
}: ComposerReferenceChipsProps) {
  if (references.length === 0) return null;
  return (
    <section className="novel-composer-references" aria-label="已引用内容">
      <ul>
        {references.map((reference) => (
          <li data-reference-kind={reference.kind} key={reference.key}>
            <span className="novel-composer-reference-kind">
              {referenceKindLabel(reference.kind)}
            </span>
            {onOpen === undefined ? (
              <span className="novel-composer-reference-label">{reference.label}</span>
            ) : (
              <button
                className="novel-composer-reference-open"
                type="button"
                disabled={disabled}
                onClick={() => onOpen(reference)}
              >
                {reference.label}
              </button>
            )}
            <button
              className="novel-composer-reference-remove"
              type="button"
              aria-label={`移除引用：${reference.label}`}
              disabled={disabled}
              onClick={() => onRemove(reference)}
            >
              移除
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function referenceKindLabel(kind: ComposerContentReference["kind"]): string {
  switch (kind) {
    case "story-unit": return "大纲";
    case "manuscript-block": return "正文";
    case "character": return "人物";
    case "location": return "地点";
    case "novel-operation": return "修改";
    case "schedule": return "安排";
  }
}
