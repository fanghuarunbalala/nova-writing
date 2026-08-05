/**
 * ComposerDraftStore
 *
 * 对话维度的本地草稿（文本/模式/引用），按 conversationId 索引。
 * 仅进程内持久化（不写 core）。快照为不可变数组，任何草稿变更整体替换。
 */
import { ExternalStore } from "../../../shared/state/ExternalStore.js";

export type ComposerMode = "chat" | "plan" | "rewrite" | "continue";

export interface ComposerReference {
  readonly kind: "character" | "location" | "outline";
  readonly id: string;
  readonly label: string;
}

export interface ComposerDraft {
  readonly conversationId: string;
  readonly text: string;
  readonly mode: ComposerMode;
  readonly references: readonly ComposerReference[];
  readonly updatedAt: number;
}

function defaultDraft(conversationId: string): ComposerDraft {
  return Object.freeze({
    conversationId,
    text: "",
    mode: "chat" as const,
    references: Object.freeze([]),
    updatedAt: 0,
  });
}

function requireConversationId(value: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError("Conversation id is required");
  }
  return value;
}

function requireText(value: string): string {
  if (typeof value !== "string" || value.includes("\u0000")) {
    throw new TypeError("Composer draft text is invalid");
  }
  return value;
}

export class ComposerDraftStore extends ExternalStore<readonly ComposerDraft[]> {
  constructor() {
    super(Object.freeze([]));
  }

  /** 读取草稿；未存在的对话返回默认草稿（不写入 store）。 */
  getDraft(conversationId: string): ComposerDraft {
    const capturedId = requireConversationId(conversationId);
    const existing = this.snapshot.find((draft) => draft.conversationId === capturedId);
    return existing ?? defaultDraft(capturedId);
  }

  setText(conversationId: string, text: string): void {
    const capturedId = requireConversationId(conversationId);
    const capturedText = requireText(text);
    this.upsert(capturedId, (draft) =>
      draft.text === capturedText
        ? draft
        : { ...draft, text: capturedText, updatedAt: Date.now() },
    );
  }

  setMode(conversationId: string, mode: ComposerMode): void {
    const capturedId = requireConversationId(conversationId);
    this.upsert(capturedId, (draft) =>
      draft.mode === mode ? draft : { ...draft, mode, updatedAt: Date.now() },
    );
  }

  addReference(conversationId: string, reference: ComposerReference): void {
    const capturedId = requireConversationId(conversationId);
    const captured = captureReference(reference);
    this.upsert(capturedId, (draft) => {
      if (draft.references.some((item) => item.kind === captured.kind && item.id === captured.id)) {
        return draft;
      }
      return {
        ...draft,
        references: [...draft.references, captured],
        updatedAt: Date.now(),
      };
    });
  }

  removeReference(conversationId: string, referenceId: string): void {
    const capturedId = requireConversationId(conversationId);
    const capturedReferenceId = requireConversationId(referenceId);
    this.upsert(capturedId, (draft) => {
      const references = draft.references.filter((item) => item.id !== capturedReferenceId);
      if (references.length === draft.references.length) return draft;
      return { ...draft, references, updatedAt: Date.now() };
    });
  }

  /** 清除该对话的草稿（回到默认态）。 */
  clear(conversationId: string): void {
    const capturedId = requireConversationId(conversationId);
    if (!this.snapshot.some((draft) => draft.conversationId === capturedId)) return;
    this.setSnapshot(
      this.snapshot.filter((draft) => draft.conversationId !== capturedId),
    );
  }

  private upsert(conversationId: string, update: (draft: ComposerDraft) => ComposerDraft): void {
    const current = this.getDraft(conversationId);
    const next = update(current);
    if (next === current) return;
    const rest = this.snapshot.filter((draft) => draft.conversationId !== conversationId);
    this.setSnapshot(
      [...rest, next].sort((left, right) =>
        left.conversationId.localeCompare(right.conversationId),
      ),
    );
  }
}

function captureReference(reference: ComposerReference): ComposerReference {
  if (
    reference === null ||
    typeof reference !== "object" ||
    !["character", "location", "outline"].includes(reference.kind) ||
    typeof reference.id !== "string" ||
    reference.id.trim() === ""
  ) {
    throw new TypeError("Composer reference is invalid");
  }
  return Object.freeze({
    kind: reference.kind,
    id: reference.id,
    label: typeof reference.label === "string" ? reference.label : reference.id,
  });
}
