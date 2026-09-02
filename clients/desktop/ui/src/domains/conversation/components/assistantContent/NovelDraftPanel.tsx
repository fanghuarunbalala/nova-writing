/**
 * NovelDraftPanel
 *
 * 正文草稿面板（```novel 代码块内容）：把小说正文与聊天注释在视觉上彻底分开。
 * 排版对齐小说出版惯例：衬线（--font-body）16.5px / 行高 1.95 / 首行缩进 2em /
 * 两端对齐；容器左竖线 + 暖底（accent 微光 + orange 渐变顶光）。
 * 流式期间末尾段落挂闪烁光标（draft-cursor，animations.css）；完成后提供
 * 「复制正文」（navigator.clipboard，缺失降级 execCommand，成功经 onNotify 上行 Toast）。
 */
import { useState } from "react";
import type { ToastKind } from "../../../../shared/state/ToastStore.js";
import styles from "./NovelDraftPanel.module.css";

export interface NovelDraftPanelProps {
  /** 小说正文原文（```novel 内的内容；按空行分段，段内换行保留）。 */
  readonly content: string;
  /** 流式进行中：末尾显示闪烁光标并隐藏复制按钮。 */
  readonly streaming?: boolean;
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

export function NovelDraftPanel({
  content,
  streaming = false,
  onNotify,
}: NovelDraftPanelProps) {
  const [copied, setCopied] = useState(false);
  const paragraphs = content
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== "");

  const handleCopy = async (): Promise<void> => {
    const plain = content.trim();
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
      onNotify?.("success", "已复制正文");
      window.setTimeout(() => setCopied(false), COPY_RESET_MS);
    }
  };

  return (
    <section className={styles.draft} aria-label="正文草稿">
      <header className={styles.kicker}>
        <span className={styles.dot} aria-hidden="true" />
        正文草稿
        {streaming ? <span className={styles.badge}>生成中</span> : null}
      </header>
      <div className={styles.text}>
        {paragraphs.length > 0 ? (
          paragraphs.map((paragraph, index) => (
            <p key={index}>
              {paragraph}
              {streaming && index === paragraphs.length - 1 ? (
                <span className={styles.cursor} aria-hidden="true" />
              ) : null}
            </p>
          ))
        ) : streaming ? (
          <p>
            <span className={styles.cursor} aria-hidden="true" />
          </p>
        ) : null}
      </div>
      {!streaming ? (
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.copy}
            onClick={() => void handleCopy()}
            aria-label="复制正文"
          >
            {copied ? "已复制" : "复制正文"}
          </button>
        </div>
      ) : null}
    </section>
  );
}
