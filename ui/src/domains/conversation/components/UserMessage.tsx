/**
 * UserMessage
 *
 * 用户消息（原型 .msg.user + .msg-body + .msg-text + .msg-actions）：
 *   无头像、无 who/time 头部；根 flex-direction:row-reverse、.body
 *   align-items:flex-end，气泡贴右；气泡统一 16px 圆角、text-align:left。
 *   气泡右下角隐藏式复制按钮（.msg-actions），hover 气泡/按钮/focus 显形；
 *   首条消息用 inPad 态收进气泡内边距带（原型 .msg-actions-inpad）。
 *   复制走 navigator.clipboard.writeText，缺失时降级 execCommand；
 *   成功提示经 onNotify 上行到 shell ToastHost。
 * memo 包裹：历史消息（text 原值稳定）零重渲染。
 */
import { memo, useState } from "react";
import type { ToastKind } from "../../../shared/state/ToastStore.js";
import { parseMessageText } from "./parseMessageText.js";
import type { MessageReference, ResolvedReference } from "./MessageReference.js";
import styles from "./UserMessage.module.css";

export interface UserMessageProps {
  readonly sequence: number;
  readonly text: string;
  readonly timestamp: number;
  /** 首条用户消息：复制按钮收进气泡内边距带（原型 .msg-actions-inpad）。 */
  readonly inPad?: boolean;
  readonly onReferenceClick?: (reference: MessageReference) => void;
  readonly resolveReference?: (reference: MessageReference) => ResolvedReference | undefined;
  /** 复制结果提示（shell 层 ToastHost）；未提供时仅按钮本地反馈。 */
  readonly onNotify?: (kind: ToastKind, text: string) => void;
}

const COPY_RESET_MS = 1600;

/** execCommand 降级复制（navigator.clipboard 不可用时）。 */
function fallbackCopy(text: string): boolean {
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "absolute";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

export const UserMessage = memo(function UserMessage({
  sequence,
  text,
  inPad = false,
  onReferenceClick,
  resolveReference,
  onNotify,
}: UserMessageProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (): Promise<void> => {
    const plain = text.trim();
    if (plain === "") {
      onNotify?.("warn", "没有可复制的内容");
      return;
    }
    let ok = false;
    try {
      if (navigator.clipboard?.writeText !== undefined) {
        await navigator.clipboard.writeText(plain);
        ok = true;
      } else {
        ok = fallbackCopy(plain);
      }
    } catch {
      ok = fallbackCopy(plain);
    }
    if (ok) {
      setCopied(true);
      onNotify?.("success", "已复制消息");
      window.setTimeout(() => setCopied(false), COPY_RESET_MS);
    }
  };

  const rootClass = inPad ? `${styles.message} ${styles.actionsInPad}` : styles.message;

  return (
    <div className={rootClass} data-sequence={sequence}>
      <div className={styles.body}>
        <div className={styles.text}>
          {parseMessageText(text, onReferenceClick, resolveReference)}
        </div>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.action}
            onClick={() => { void handleCopy(); }}
            aria-label={copied ? "已复制" : "复制消息"}
            title={copied ? "已复制" : "复制消息"}
          >
            {copied ? (
              <svg
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M3.5 8.5l3 3 6-6" />
              </svg>
            ) : (
              <svg
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="6" y="6" width="7.5" height="7.5" rx="1.5" />
                <path d="M10 6V4.5A1.5 1.5 0 0 0 8.5 3H4.5A1.5 1.5 0 0 0 3 4.5v4A1.5 1.5 0 0 0 4.5 10H6" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
});
