/**
 * ConversationComposer
 *
 * 输入区（原型 .composer）：gen-status（生成状态胶囊）+ form(textarea + send) + mode-bar。
 * 生成状态胶囊位于输入框正上方（原型位置）；模式栏置于 form 下方，发送后清空本地输入。
 */
import { useState, type KeyboardEvent } from "react";
import { Button } from "../../../shared/primitives/Button.js";
import { GenStatus, type GenStatusProps } from "./GenStatus.js";
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
  /** 生成状态（原型 .gen-status）；undefined 时不渲染。由 ChatSurface 注入运行时状态。 */
  readonly status?: GenStatusProps;
}

export function ConversationComposer({
  conversationId,
  enabled,
  onSend,
  status,
}: ConversationComposerProps) {
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
      {status !== undefined ? <GenStatus {...status} /> : null}
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
