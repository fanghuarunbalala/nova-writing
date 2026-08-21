/**
 * ProjectSelectionPage（欢迎页）
 *
 * 启动时（未打开任何项目）的全屏欢迎页，对齐 docs/design/app-redesign-demo.html
 * 「启动 · 项目选择页」：品牌区（渐变圆点 + Novel + 标语）→ 「最近的项目」书封
 * 卡片列表 → 「新建项目 / 打开其他项目…」双按钮（新建走 save 型对话框命名建目录，
 * 打开走目录选择器选已有文件夹）。卡片右上角提供删除入口（PRD workspace-删除项目：
 * 欢迎页无「当前项目」，全部可删；danger 二次确认明示不可恢复）。
 * 元素级联浮入（view-in 0.5s，0.05/0.12/0.18/0.24s 依次）；进入 opening 阶段时
 * 整页缩放模糊退场（welcome-leave），后续由 NovelApp 的启动编排接管（分步加载遮罩
 * → 工作台 boot-in）。
 */
import { ArrowRight, FolderOpen, Plus, Trash2 } from "lucide-react";
import { useState, type CSSProperties } from "react";
import type {
  WorkspaceControllerSnapshot,
  WorkspaceSessionView,
} from "../controller/WorkspaceController.js";
import { Button } from "../../../shared/primitives/Button.js";
import { ConfirmDialog } from "../../../shared/primitives/ConfirmDialog.js";
import { Icon } from "../../../shared/primitives/Icon.js";
import { formatRelativeTime } from "../../../shared/format/relativeTime.js";
import styles from "./ProjectSelectionPage.module.css";

/** 书封双色板（demo WS_COVERS 起始三色扩充至八；label 哈希稳定取色） */
const COVER_PALETTE: readonly (readonly [string, string])[] = [
  ["#a0522d", "#d9a066"],
  ["#41708f", "#9fc0cf"],
  ["#6d675e", "#3a342e"],
  ["#54622f", "#a3b378"],
  ["#7a3b5e", "#c98ba9"],
  ["#2f6d5a", "#8fc0ae"],
  ["#8a5a2b", "#d9b48a"],
  ["#454560", "#9d9db8"],
];

function coverStyle(label: string): CSSProperties {
  let hash = 0;
  for (const ch of label) hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  const [cover1, cover2] = COVER_PALETTE[hash % COVER_PALETTE.length]!;
  return { "--cover-1": cover1, "--cover-2": cover2 } as CSSProperties;
}

/** 卡片副标题：相对时间 · 工作区路径（旧 registry 数据可能两者皆缺） */
function formatSessionSub(session: WorkspaceSessionView): string {
  const time =
    session.lastOpenedAt !== undefined
      ? formatRelativeTime(Date.parse(session.lastOpenedAt))
      : "";
  const parts = [time, session.rootPath].filter(
    (part): part is string => part !== undefined && part.trim() !== "",
  );
  return parts.join(" · ");
}

export interface ProjectSelectionPageProps {
  readonly snapshot: WorkspaceControllerSnapshot;
  /** 打开其他项目（原生目录选择器，选已有文件夹） */
  readonly onChoose: () => void;
  /** 新建项目（save 型对话框命名 → 建目录 → 打开）；与 onChoose 分开接线 */
  readonly onCreate: () => void;
  readonly onOpenRecent: (workspaceId: string) => void;
  /** 删除项目（仅应用侧数据，经 controller danger 确认后调用）；返回是否成功 */
  readonly onDeleteRecent: (workspaceId: string) => Promise<boolean>;
  /** 重开新手引导向导（缺省隐藏入口） */
  readonly onOpenGuide?: () => void;
}

export function ProjectSelectionPage({
  snapshot,
  onChoose,
  onCreate,
  onOpenRecent,
  onDeleteRecent,
  onOpenGuide,
}: ProjectSelectionPageProps) {
  const busy =
    snapshot.phase === "loading" ||
    snapshot.phase === "selecting" ||
    snapshot.phase === "opening" ||
    snapshot.phase === "closing";
  const opening = snapshot.phase === "selecting" || snapshot.phase === "opening";
  // 删除确认弹窗（参照 ConversationDialogs 的 target/busy 模式）：busy 锁重复提交，
  // 结束（无论成败）即关闭——失败详情经 controller error 通道展示在页面错误区
  const [deleteTarget, setDeleteTarget] = useState<WorkspaceSessionView | undefined>(undefined);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const confirmDelete = async (): Promise<void> => {
    if (deleteTarget === undefined || deleteBusy) return;
    setDeleteBusy(true);
    try {
      await onDeleteRecent(deleteTarget.id);
    } finally {
      setDeleteBusy(false);
      setDeleteTarget(undefined);
    }
  };
  return (
    <div
      className={snapshot.phase === "opening" ? `${styles.page} ${styles.leave}` : styles.page}
      aria-label="打开项目"
    >
      <div className={styles.inner}>
        <div className={styles.brand}>
          <span className={styles.brandDot} aria-hidden="true" />
          <div className={styles.brandName}>Novel</div>
          <div className={styles.brandTag}>把一桩旧事，写成一本新书。</div>
        </div>
        <h2 className={styles.secTitle}>最近的项目</h2>
        {snapshot.recent.length === 0 ? (
          <p className={styles.empty}>还没有打开过项目——从下方「新建项目」开始</p>
        ) : (
          <ul className={styles.recentList}>
            {snapshot.recent.map((workspace) => {
              const sub = formatSessionSub(workspace);
              return (
                <li key={workspace.id} className={styles.projItem}>
                  <button
                    type="button"
                    className={styles.projCard}
                    disabled={busy}
                    onClick={() => onOpenRecent(workspace.id)}
                  >
                    <span className={styles.projCover} style={coverStyle(workspace.label)} aria-hidden="true">
                      {Array.from(workspace.label)[0] ?? "?"}
                    </span>
                    <span className={styles.projText}>
                      <strong className={styles.projName}>{workspace.label}</strong>
                      {sub !== "" ? <small className={styles.projSub}>{sub}</small> : null}
                    </span>
                    <span className={styles.projOpen}>
                      打开 <Icon icon={ArrowRight} size="sm" />
                    </span>
                  </button>
                  <button
                    type="button"
                    className={styles.projDelete}
                    disabled={busy}
                    title="删除项目"
                    aria-label={`删除项目 ${workspace.label}`}
                    onClick={() => setDeleteTarget(workspace)}
                  >
                    <Icon icon={Trash2} size="sm" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <div className={styles.actions}>
          <Button
            variant="primary"
            size="lg"
            fullWidth
            loading={opening}
            disabled={busy}
            leadingIcon={<Icon icon={Plus} size="sm" />}
            onClick={onCreate}
          >
            新建项目
          </Button>
          <Button
            variant="secondary"
            size="lg"
            fullWidth
            disabled={busy}
            leadingIcon={<Icon icon={FolderOpen} size="sm" />}
            onClick={onChoose}
          >
            打开其他项目…
          </Button>
        </div>
        {snapshot.error !== undefined ? (
          <p className={styles.error} role="status">
            {snapshot.error.message}
          </p>
        ) : null}
        {onOpenGuide !== undefined ? (
          <button type="button" className={styles.guideLink} onClick={onOpenGuide}>
            查看新手引导
          </button>
        ) : null}
      </div>
      <ConfirmDialog
        open={deleteTarget !== undefined}
        onOpenChange={(next) => {
          if (!next) setDeleteTarget(undefined);
        }}
        title="删除项目"
        description={
          deleteTarget !== undefined
            ? `确定删除项目「${deleteTarget.label}」吗？将永久删除该项目的全部应用数据（小说内容、AI 会话记录等）和整个项目文件夹（含其中的全部文件），不可恢复。${
                deleteTarget.rootPath !== undefined ? `项目文件夹：${deleteTarget.rootPath}` : ""
              }`
            : undefined
        }
        confirmLabel="删除"
        busy={deleteBusy}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
