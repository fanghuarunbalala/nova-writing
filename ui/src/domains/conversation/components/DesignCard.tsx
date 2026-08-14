/**
 * DesignCard
 *
 * compose 设计草稿卡：读取 design 文件并以 Markdown 渲染，支持编辑/保存写回。
 * designFile 能力缺失时降级为只读提示（web 等非桌面场景）。
 * memo 包裹：conversationId/phase 稳定即零重渲染（内部含 markdown 渲染）。
 */
import { memo, useEffect, useState } from "react";
import { useFrontendPlatform } from "../../../platform/index.js";
import { AssistantMarkdown } from "./assistantContent/index.js";
import styles from "./DesignCard.module.css";

export interface DesignCardProps {
  readonly conversationId: string;
  readonly phase: string;
}

const PHASE_LABEL: Record<string, string> = {
  designing: "设计中",
  pending: "待审批",
  applied: "已批准",
  discarded: "已放弃",
};

export const DesignCard = memo(function DesignCard({ conversationId, phase }: DesignCardProps) {
  const platform = useFrontendPlatform();
  const designFile = platform.designFile;
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    if (designFile === undefined) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(undefined);
    designFile
      .read(conversationId)
      .then((text) => {
        if (!cancelled) {
          setContent(text);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError("读取设计草稿失败");
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId, designFile]);

  const save = async (): Promise<void> => {
    if (designFile === undefined) return;
    setSaving(true);
    try {
      await designFile.write(conversationId, content);
      setEditing(false);
      setError(undefined);
    } catch {
      setError("保存设计草稿失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.card}>
      <header className={styles.header}>
        <span className={styles.title}>设计草稿</span>
        <span className={styles.phase}>{PHASE_LABEL[phase] ?? phase}</span>
      </header>
      {designFile === undefined ? (
        <p className={styles.note}>设计草稿文件能力不可用。</p>
      ) : loading ? (
        <p className={styles.note}>加载中…</p>
      ) : error !== undefined ? (
        <p className={styles.error}>{error}</p>
      ) : editing ? (
        <div className={styles.editor}>
          <textarea
            className={styles.textarea}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            spellCheck={false}
          />
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.save}
              disabled={saving}
              onClick={() => void save()}
            >
              {saving ? "保存中…" : "保存"}
            </button>
            <button
              type="button"
              className={styles.cancel}
              disabled={saving}
              onClick={() => setEditing(false)}
            >
              取消
            </button>
          </div>
        </div>
      ) : (
        <div className={styles.preview}>
          <AssistantMarkdown text={content} />
          <button
            type="button"
            className={styles.edit}
            onClick={() => setEditing(true)}
          >
            编辑
          </button>
        </div>
      )}
    </div>
  );
});
