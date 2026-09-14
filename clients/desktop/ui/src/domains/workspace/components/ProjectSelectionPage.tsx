/**
 * ProjectSelectionPage（欢迎页 · 纯云端化 ⑥ 云-only）
 *
 * 启动时（未打开任何项目）的全屏欢迎页：品牌区 → 同步状态卡 → 云端项目列表
 * （server 权威列表 + 新建只命名 + 打开 + 删除二次确认）。未登录时列表区呈现
 * 登录引导。本地项目入口（目录选择器/本地新建/文件导入）已随本地模式退役。
 * 元素级联浮入（view-in 0.5s，0.05/0.12/0.18/0.24s 依次）；进入 opening 阶段时
 * 整页缩放模糊退场（welcome-leave），后续由 NovelApp 的启动编排接管。
 */
import { ArrowRight, Cloud, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import type { ServerAuthState } from "@novel/core";
import type { WorkspaceControllerSnapshot } from "../controller/WorkspaceController.js";
import { Button } from "../../../shared/primitives/Button.js";
import { ConfirmDialog } from "../../../shared/primitives/ConfirmDialog.js";
import { Dialog } from "../../../shared/primitives/Dialog.js";
import { Input } from "../../../shared/primitives/Input.js";
import { Icon } from "../../../shared/primitives/Icon.js";
import { formatRelativeTime } from "../../../shared/format/relativeTime.js";
import styles from "./ProjectSelectionPage.module.css";

/** 云端项目视图（server /v1/projects；referenceId = 本地登记条目，缺省 = 他端创建未打开） */
export interface CloudProjectView {
  readonly id: string;
  readonly name: string;
  readonly lastActivityAt: number | null;
  readonly archived: boolean;
  readonly referenceId?: string;
}

export interface ProjectSelectionPageProps {
  readonly snapshot: WorkspaceControllerSnapshot;
  /** 重开新手引导向导（缺省隐藏入口） */
  readonly onOpenGuide?: () => void;
  /** server 登录状态（未登录 → 列表区登录引导） */
  readonly serverAuthState?: ServerAuthState;
  /** 打开登录页（未登录入口卡点击） */
  readonly onOpenLogin?: () => void;
  /** 已登录态点击入口卡 → 设置 → Server（设备管理/登出） */
  readonly onOpenSettings?: () => void;
  /** 云端项目分区（宿主接线 cloudProjects 时提供；老 main 缺省 → 升级提示） */
  readonly cloudSection?: {
    readonly projects: ReadonlyArray<CloudProjectView>;
    readonly busy?: boolean;
    readonly error?: string;
    readonly onCreate: (name: string) => void;
    readonly onOpen: (project: { id: string; name: string }) => void;
    /** 删除云端项目（server 软删 + 本地缓存清理）；返回是否成功 */
    readonly onDelete: (projectId: string) => Promise<boolean>;
  };
}

export function ProjectSelectionPage({
  snapshot,
  onOpenGuide,
  serverAuthState,
  onOpenLogin,
  onOpenSettings,
  cloudSection,
}: ProjectSelectionPageProps) {
  const busy =
    snapshot.phase === "loading" ||
    snapshot.phase === "selecting" ||
    snapshot.phase === "opening" ||
    snapshot.phase === "closing";
  // 真实已登录（v0.1 修正）：offline/needRelogin 的僵尸态不算——入口卡回到「未登录开门」，
  // 否则云端操作报「未登录」却无重登入口
  const loggedIn =
    serverAuthState?.username !== undefined &&
    serverAuthState.status === "online" &&
    serverAuthState.needRelogin !== true;
  // 云项目删除确认（danger 二次确认：server 端删除后所有设备不可见）
  const [deleteTarget, setDeleteTarget] = useState<CloudProjectView | undefined>(undefined);
  const [deleteBusy, setDeleteBusy] = useState(false);
  // 云项目新建：仅命名，无目录对话框
  const [cloudCreateOpen, setCloudCreateOpen] = useState(false);
  const [cloudName, setCloudName] = useState("");
  const confirmDelete = async (): Promise<void> => {
    if (deleteTarget === undefined || deleteBusy || cloudSection === undefined) return;
    setDeleteBusy(true);
    try {
      await cloudSection.onDelete(deleteTarget.id);
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
        {serverAuthState !== undefined && onOpenLogin !== undefined ? (
          <button
            type="button"
            className={styles.syncCard}
            data-online={loggedIn ? "true" : undefined}
            onClick={loggedIn ? onOpenSettings : onOpenLogin}
          >
            <span className={styles.syncIcon} aria-hidden="true">
              <Icon icon={Cloud} size="sm" />
            </span>
            <span className={styles.syncText}>
              {loggedIn ? (
                <>
                  <strong className={styles.syncTitle}>
                    已连接同步 · {serverAuthState.username}
                  </strong>
                  <small className={styles.syncSub}>点击管理设备与连接（设置 → Server）</small>
                </>
              ) : (
                <>
                  <strong className={styles.syncTitle}>登录同步服务</strong>
                  <small className={styles.syncSub}>登录后打开你的云端项目，多端接续写作</small>
                </>
              )}
            </span>
            <span className={styles.projOpen} aria-hidden="true">
              <Icon icon={ArrowRight} size="sm" />
            </span>
          </button>
        ) : null}
        <div className={styles.cloudHead}>
          <h2 className={styles.secTitle}>云端项目</h2>
          {cloudSection !== undefined && loggedIn ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={cloudSection.busy === true}
              leadingIcon={<Icon icon={Plus} size="sm" />}
              onClick={() => setCloudCreateOpen(true)}
            >
              新建云端项目
            </Button>
          ) : null}
        </div>
        {cloudSection === undefined ? (
          <p className={styles.empty}>当前应用版本不支持云端项目——请更新应用后登录使用。</p>
        ) : !loggedIn ? (
          <p className={styles.empty}>登录后即可查看并打开你的云端项目（上方卡片进入登录）。</p>
        ) : (
          <>
            {cloudSection.error !== undefined ? (
              <p className={styles.error} role="status">{cloudSection.error}</p>
            ) : null}
            {cloudSection.projects.filter((p) => !p.archived).length === 0 ? (
              <p className={styles.empty}>还没有云端项目——起个名字就开一本新书（无需选文件夹，多端同步）</p>
            ) : (
              <ul className={styles.recentList}>
                {cloudSection.projects
                  .filter((p) => !p.archived)
                  .map((p) => (
                    <li key={p.id} className={styles.projItem}>
                      <button
                        type="button"
                        className={styles.projCard}
                        disabled={busy}
                        onClick={() => cloudSection.onOpen({ id: p.id, name: p.name })}
                      >
                        <span className={styles.cloudCover} aria-hidden="true">
                          <Icon icon={Cloud} size="sm" />
                        </span>
                        <span className={styles.projText}>
                          <strong className={styles.projName}>{p.name}</strong>
                          {p.lastActivityAt !== null ? (
                            <small className={styles.projSub}>
                              {formatRelativeTime(p.lastActivityAt)} · 云端 · 多端接续
                            </small>
                          ) : (
                            <small className={styles.projSub}>云端 · 多端接续</small>
                          )}
                        </span>
                        <span className={styles.projOpen}>
                          打开 <Icon icon={ArrowRight} size="sm" />
                        </span>
                      </button>
                      <button
                        type="button"
                        className={styles.projDelete}
                        disabled={busy}
                        title="删除云端项目"
                        aria-label={`删除云端项目 ${p.name}`}
                        onClick={() => setDeleteTarget(p)}
                      >
                        <Icon icon={Trash2} size="sm" />
                      </button>
                    </li>
                  ))}
              </ul>
            )}
          </>
        )}
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
        title="删除云端项目"
        description={
          deleteTarget !== undefined
            ? `确定删除云端项目「${deleteTarget.name}」吗？项目将从你的 server 上删除（所有设备不再可见），本设备的缓存数据一并清理，不可恢复。`
            : undefined
        }
        confirmLabel="删除"
        busy={deleteBusy}
        onConfirm={() => void confirmDelete()}
      />
      {cloudSection !== undefined ? (
        <Dialog
          open={cloudCreateOpen}
          onOpenChange={(next) => {
            if (!next) setCloudCreateOpen(false);
          }}
          title="新建云端项目"
          footer={
            <>
              <Button
                variant="secondary"
                disabled={cloudSection.busy === true}
                onClick={() => setCloudCreateOpen(false)}
              >
                取消
              </Button>
              <Button
                variant="primary"
                disabled={cloudSection.busy === true || cloudName.trim().length === 0}
                loading={cloudSection.busy === true}
                onClick={() => {
                  const name = cloudName.trim();
                  if (name === "") return;
                  setCloudCreateOpen(false);
                  setCloudName("");
                  cloudSection.onCreate(name);
                }}
              >
                创建并打开
              </Button>
            </>
          }
        >
          <div className={styles.cloudForm}>
            <label className={styles.cloudFormLabel} htmlFor="cloud-project-name">
              项目名
            </label>
            <Input
              id="cloud-project-name"
              value={cloudName}
              autoFocus
              placeholder="如：雪落长街"
              onChange={(event) => setCloudName(event.currentTarget.value)}
            />
            <p className={styles.cloudFormHint}>
              只需一个名字——项目保存在你的 server 上，任何设备登录即可接续写作。
            </p>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
