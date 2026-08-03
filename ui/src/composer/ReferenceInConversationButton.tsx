/** Inspector action that adds one immutable local reference to the active draft. */
import { useApplicationShellSnapshot } from "../state/index.js";
import {
  captureComposerContentReference,
  sameComposerContentReference,
  type ComposerContentReference,
} from "./ComposerContentReference.js";
import { useComposerDraftBinding } from "./ComposerDraftStoreContext.js";

export interface ReferenceInConversationButtonProps {
  readonly reference: ComposerContentReference;
  readonly onReferenced?: (reference: ComposerContentReference) => void;
}

export function ReferenceInConversationButton({
  reference,
  onReferenced,
}: ReferenceInConversationButtonProps) {
  const shell = useApplicationShellSnapshot();
  const captured = captureComposerContentReference(reference);
  if (shell.conversation === undefined) {
    return (
      <button
        className="novel-reference-in-conversation"
        type="button"
        data-reference-state="unavailable"
        disabled
      >
        没有当前对话
      </button>
    );
  }
  return (
    <BoundReferenceInConversationButton
      conversationId={shell.conversation.id}
      reference={captured}
      onReferenced={onReferenced}
    />
  );
}

function BoundReferenceInConversationButton({
  conversationId,
  reference,
  onReferenced,
}: {
  readonly conversationId: string;
  readonly reference: ComposerContentReference;
  readonly onReferenced?: (reference: ComposerContentReference) => void;
}) {
  const draft = useComposerDraftBinding(conversationId);
  const existing = draft.snapshot.references.find(
    (candidate) => candidate.key === reference.key,
  );
  const referenced =
    existing !== undefined && sameComposerContentReference(existing, reference);
  const conflict = existing !== undefined && !referenced;
  return (
    <button
      className="novel-reference-in-conversation"
      type="button"
      data-reference-state={conflict ? "conflict" : referenced ? "referenced" : "ready"}
      disabled={referenced || conflict}
      onClick={() => {
        draft.store.addReference(conversationId, reference);
        onReferenced?.(reference);
      }}
    >
      {conflict ? "引用身份冲突" : referenced ? "已引用" : "引用到对话"}
    </button>
  );
}
