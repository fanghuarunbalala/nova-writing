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
import { Check, Copy } from "lucide-react";
import type { ToastKind } from "../../../shared/state/ToastStore.js";
import { Icon } from "../../../shared/primitives/Icon.js";
import { parseMessageText, splitTrailingReferences } from "./parseMessageText.js";
import { ReferenceChips } from "./ReferenceChips.js";
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

  // 尾部引用标签块剥离为顶部 chips 行（core 把 references 序列化为整行标签
  // 追加在正文后；对齐 demo .msgRefs：气泡顶部 chips + 正文文本）
  const { text: bodyText, references } = splitTrailingReferences(text);

  return (
    <div className={rootClass} data-sequence={sequence}>
      <div className={styles.body}>
        <div className={styles.text}>
          {references.length > 0 ? (
            <div className={styles.references}>
              <ReferenceChips
                dense
                references={references.map((reference) => ({
                  kind: reference.refKind,
                  id: reference.id,
                  label: reference.label ?? reference.id,
                }))}
                onReferenceClick={
                  onReferenceClick !== undefined
                    ? (reference) =>
                        onReferenceClick({
                          refKind: reference.kind,
                          id: reference.id,
                          label: reference.label,
                        })
                    : undefined
                }
              />
            </div>
          ) : null}
          {bodyText !== "" ? parseMessageText(bodyText, onReferenceClick, resolveReference) : null}
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
              <Icon icon={Check} size="sm" strokeWidth={2} />
            ) : (
              <Icon icon={Copy} size="sm" strokeWidth={1.4} />
            )}
          </button>
        </div>
      </div>
    </div>
  );
});
