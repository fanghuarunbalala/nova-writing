/**
 * ConversationComposer
 *
 * 输入区（原型 .composer）：gen-status + form(textarea + send) + mode-bar。
 * 模式栏置于 form 下方（与原型一致），发送后清空本地输入。
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
  const [mode, setMode] = useState<ComposerMode>("review");
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
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label className={styles.srOnly} htmlFor={`composer-input-${conversationId}`}>
          创作指令
        </label>
        <textarea
          id={`composer-input-${conversationId}`}
          className={styles.input}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入创作指令，例如：让林夏在旧船坞发现货单、起草白鹭旅馆场景"
          disabled={!enabled}
          rows={1}
          aria-label="对话输入"
          data-conversation={conversationId}
        />
        <Button variant="primary" onClick={submit} disabled={!enabled || text.trim() === ""}>
          发送
        </Button>
      </form>
      <ComposerModeBar mode={mode} onChange={setMode} disabled={!enabled} />
    </div>
  );
}
