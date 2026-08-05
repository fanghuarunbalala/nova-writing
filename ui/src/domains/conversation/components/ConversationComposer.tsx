/**
 * ConversationComposer
 *
 * 输入区：模式栏 + 文本框 + 发送。发送后清空本地输入。
 */
import { useState, type KeyboardEvent } from "react";
import { Button } from "../../../shared/primitives/Button.js";
import type { ComposerMode } from "../store/ComposerDraftStore.js";
import { ComposerModeBar } from "./ComposerModeBar.js";
import styles from "./ConversationComposer.module.css";

export interface ComposerInput {
  readonly text: string;
  readonly mode: ComposerMode;
  readonly references: readonly { readonly kind: "character" | "location" | "outline"; readonly id: string; readonly label: string }[];
}

export interface ConversationComposerProps {
  readonly conversationId: string;
  readonly enabled: boolean;
  readonly onSend: (input: ComposerInput) => void;
}

export function ConversationComposer({ conversationId, enabled, onSend }: ConversationComposerProps) {
  const [mode, setMode] = useState<ComposerMode>("chat");
  const [text, setText] = useState("");

  const submit = (): void => {
    const trimmed = text.trim();
    if (trimmed === "") return;
    onSend({ text: trimmed, mode, references: [] });
    setText("");
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div className={styles.composer}>
      <ComposerModeBar mode={mode} onChange={setMode} disabled={!enabled} />
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <textarea
          className={styles.input}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入消息，Enter 发送，Shift+Enter 换行"
          disabled={!enabled}
          rows={2}
          aria-label="对话输入"
          data-conversation={conversationId}
        />
        <Button variant="primary" onClick={submit} disabled={!enabled || text.trim() === ""}>
          发送
        </Button>
      </form>
    </div>
  );
}
