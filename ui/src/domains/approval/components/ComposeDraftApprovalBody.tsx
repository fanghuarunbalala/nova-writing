/**
 * ComposeDraftApprovalBody
 *
 * ExitComposeMode 审批卡的 CCB 式正文：以 design 文件内容为审批确认对象。
 * 经 designFile 端口按 conversationId 读取草稿（DesignCard 同机制），
 * Markdown 只读渲染；支持作者在审批前直接编辑草稿（textarea → write 写回）。
 * 描述（含「设计文件：」路径行）与模型提交说明作为辅助。
 * designFile 能力缺失（web 等）降级为只读提示、不显示编辑入口。
 */
import { useEffect, useState } from "react";
import { useFrontendPlatform } from "../../../platform/index.js";
import { AssistantMarkdown } from "../../conversation/components/assistantContent/index.js";
import styles from "./ComposeDraftApprovalBody.module.css";

export interface ComposeDraftApprovalBodyProps {
  readonly conversationId: string;
  /** ExitComposeMode 模型提交说明（summary 参数）。 */
  readonly summary?: string;
  /** 审批请求描述（含「设计文件：」workspace 相对路径行）。 */
  readonly description?: string;
}

export function ComposeDraftApprovalBody({
  conversationId,
  summary,
  description,
}: ComposeDraftApprovalBodyProps) {
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

  const hasSummary = summary !== undefined && summary.trim() !== "";

  return (
    <div className={styles.body}>
      {description !== undefined && description.trim() !== "" ? (
        <p className={styles.description}>{description}</p>
      ) : null}
      {hasSummary ? (
        <div className={styles.summary}>
          <span className={styles.summaryLabel}>提交说明</span>
          <span className={styles.summaryText}>{summary}</span>
        </div>
      ) : null}
      <div className={styles.draft}>
        <div className={styles.draftHead}>
          <span className={styles.draftLabel}>设计草稿</span>
          {designFile !== undefined &&
          !loading &&
          error === undefined &&
          !editing ? (
            <button
              type="button"
              className={styles.edit}
              onClick={() => setEditing(true)}
            >
              编辑
            </button>
          ) : null}
        </div>
        {designFile === undefined ? (
          <p className={styles.note}>设计草稿文件能力不可用。</p>
        ) : loading ? (
          <p className={styles.note}>草稿加载中…</p>
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
        ) : content.trim() === "" ? (
          <p className={styles.note}>设计草稿为空。</p>
        ) : (
          <div className={styles.content}>
            <AssistantMarkdown text={content} />
          </div>
        )}
      </div>
    </div>
  );
}
