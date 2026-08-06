/**
 * ProjectSelectionPage
 *
 * 启动时（未打开任何项目）的全屏「打开项目」页：居中紧凑卡片，
 * 提供原生目录选择、最近项目列表与错误提示。选中打开成功后由 NovelApp
 * 切换到 ApplicationShell 工作台；关闭当前 Workspace 时回到本页。
 */
import type { WorkspaceControllerSnapshot } from "../controller/WorkspaceController.js";
import styles from "./ProjectSelectionPage.module.css";

export interface ProjectSelectionPageProps {
  readonly snapshot: WorkspaceControllerSnapshot;
  readonly onChoose: () => void;
  readonly onOpenRecent: (workspaceId: string) => void;
}

export function ProjectSelectionPage({
  snapshot,
  onChoose,
  onOpenRecent,
}: ProjectSelectionPageProps) {
  const busy =
    snapshot.phase === "loading" ||
    snapshot.phase === "selecting" ||
    snapshot.phase === "opening" ||
    snapshot.phase === "closing";
  const opening = snapshot.phase === "selecting" || snapshot.phase === "opening";
  const chooseLabel = opening
    ? "正在打开…"
    : snapshot.phase === "loading"
      ? "正在加载…"
      : "打开项目文件夹…";
  return (
    <div className={styles.page}>
      <section className={styles.card} aria-label="打开项目">
        <span className={styles.kicker}>Novel · 创作工作台</span>
        <h1 className={styles.title}>开始创作</h1>
        <p className={styles.description}>选择或新建一个小说项目文件夹，打开后进入创作工作台。</p>
        <button
          type="button"
          className={styles.choose}
          disabled={busy}
          onClick={onChoose}
        >
          {chooseLabel}
        </button>
        {snapshot.error !== undefined ? (
          <p className={styles.error} role="status">
            {snapshot.error.message}
          </p>
        ) : null}
        <section className={styles.recent}>
          <h2 className={styles.recentTitle}>最近打开</h2>
          {snapshot.recent.length === 0 ? (
            <p className={styles.recentEmpty}>还没有打开过项目</p>
          ) : (
            <ul className={styles.recentList}>
              {snapshot.recent.map((workspace) => (
                <li key={workspace.id}>
                  <button
                    type="button"
                    className={styles.recentItem}
                    disabled={busy}
                    onClick={() => onOpenRecent(workspace.id)}
                  >
                    <strong className={styles.recentLabel}>{workspace.label}</strong>
                    <span className={styles.recentId}>{workspace.id}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </section>
    </div>
  );
}
