/** Basic text and Stop InputEvent composer using the bound Conversation input queue. */
import {
  StopInputEvent,
  UserMessageInputEvent,
  type InputEvent,
  type InputReceipt,
} from "@novel/core";
import { useState, type FormEvent, type KeyboardEvent } from "react";

export interface ConversationComposerProps {
  readonly conversationId: string;
  readonly enabled: boolean;
  enqueue(event: InputEvent): Promise<InputReceipt>;
}

type ComposerNotice =
  | { readonly kind: "receipt"; readonly text: string }
  | { readonly kind: "error"; readonly text: string };

export function ConversationComposer({
  conversationId,
  enabled,
  enqueue,
}: ConversationComposerProps) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState<"message" | "stop" | undefined>();
  const [notice, setNotice] = useState<ComposerNotice | undefined>();

  async function submitMessage(): Promise<void> {
    const message = text.trim();
    if (!enabled || pending !== undefined || message.length === 0) return;
    setPending("message");
    setNotice(undefined);
    try {
      const receipt = await enqueue(
        new UserMessageInputEvent({ conversationId, text: message }),
      );
      setText("");
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
      const receipt = await enqueue(new StopInputEvent({ conversationId }));
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
      <textarea
        aria-label="消息内容"
        placeholder={enabled ? "在这里输入你的想法…" : "等待 Conversation 连接"}
        value={text}
        onChange={(event) => setText(event.currentTarget.value)}
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
          disabled={!enabled || pending !== undefined || text.trim().length === 0}
        >
          {pending === "message" ? "发送中" : "发送"}
        </button>
      </div>
      {notice !== undefined ? (
        <p className="novel-composer-notice" data-notice-kind={notice.kind} role="status">
          {notice.text}
        </p>
      ) : null}
    </form>
  );
}
