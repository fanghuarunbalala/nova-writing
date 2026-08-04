/** Conversation composer with local drafts and protocol-gated structured references. */
import {
  type InputEvent,
  type InputReceipt,
} from "@novel/core";
import { useState, type FormEvent, type KeyboardEvent } from "react";
import {
  ComposerReferenceChips,
  useComposerDraftBinding,
  type ComposerContentReference,
  type ComposerDraftStore,
} from "../composer/index.js";
import {
  createConversationInteractionCommands,
  type ConversationInteractionCommands,
} from "./interaction/index.js";

export interface ConversationComposerProps {
  readonly conversationId: string;
  readonly enabled: boolean;
  readonly draftStore?: ComposerDraftStore;
  readonly onOpenReference?: (reference: ComposerContentReference) => void;
  enqueue(event: InputEvent): Promise<InputReceipt>;
  readonly commands?: ConversationInteractionCommands;
}

type ComposerNotice =
  | { readonly kind: "receipt"; readonly text: string }
  | { readonly kind: "error"; readonly text: string };

export function ConversationComposer({
  conversationId,
  enabled,
  draftStore,
  onOpenReference,
  enqueue,
  commands,
}: ConversationComposerProps) {
  const effectiveCommands =
    commands ?? createConversationInteractionCommands({ conversationId, enqueue });
  const draft = useComposerDraftBinding(conversationId, draftStore);
  const [pending, setPending] = useState<"message" | "stop" | undefined>();
  const [notice, setNotice] = useState<ComposerNotice | undefined>();

  async function submitMessage(): Promise<void> {
    if (draft.snapshot.references.length > 0) {
      setNotice({
        kind: "error",
        text: "结构化引用发送协议尚未启用，请先移除引用",
      });
      return;
    }
    const message = draft.snapshot.text.trim();
    if (!enabled || pending !== undefined || message.length === 0) return;
    setPending("message");
    setNotice(undefined);
    try {
      const receipt = await effectiveCommands.send(message);
      draft.store.setText(conversationId, "");
      setNotice({
        kind: "receipt",
        text:
          receipt.status === "accepted"
            ? `消息已记录，等待 Agent 处理（#${receipt.sequence}）`
            : `重复消息已存在（#${receipt.sequence}）`,
      });
    } catch {
      setNotice({ kind: "error", text: "消息发送失败，请检查连接状态" });
    } finally {
      setPending(undefined);
    }
  }

  async function submitStop(): Promise<void> {
    if (!enabled || pending !== undefined) return;
    setPending("stop");
    setNotice(undefined);
    try {
      const receipt = await effectiveCommands.stop();
      setNotice({
        kind: "receipt",
        text: `停止请求已记录，等待 Runtime 处理（#${receipt.sequence}）`,
      });
    } catch {
      setNotice({ kind: "error", text: "停止请求发送失败，请检查连接状态" });
    } finally {
      setPending(undefined);
    }
  }

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    void submitMessage();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submitMessage();
    }
  }

  return (
    <form className="novel-conversation-composer" onSubmit={handleSubmit}>
      <ComposerReferenceChips
        references={draft.snapshot.references}
        disabled={pending !== undefined}
        onOpen={onOpenReference}
        onRemove={(reference) => {
          draft.store.removeReference(conversationId, reference.key);
        }}
      />
      <textarea
        aria-label="消息内容"
        placeholder={enabled ? "在这里输入你的想法…" : "等待 Conversation 连接"}
        value={draft.snapshot.text}
        onChange={(event) => {
          draft.store.setText(conversationId, event.currentTarget.value);
        }}
        onKeyDown={handleKeyDown}
      />
      <div className="novel-composer-actions">
        <button
          className="novel-stop-button"
          type="button"
          disabled={!enabled || pending !== undefined}
          onClick={() => void submitStop()}
        >
          {pending === "stop" ? "正在停止" : "停止"}
        </button>
        <button
          className="novel-send-button"
          type="submit"
          disabled={
            !enabled ||
            pending !== undefined ||
            draft.snapshot.text.trim().length === 0 ||
            draft.snapshot.references.length > 0
          }
        >
          {pending === "message" ? "发送中" : "发送"}
        </button>
      </div>
      {draft.snapshot.references.length > 0 ? (
        <p className="novel-composer-reference-notice" role="status">
          引用已保存在当前对话草稿中；发送将在统一 InputEvent 引用协议接入后启用。
        </p>
      ) : null}
      {notice !== undefined ? (
        <p className="novel-composer-notice" data-notice-kind={notice.kind} role="status">
          {notice.text}
        </p>
      ) : null}
    </form>
  );
}
