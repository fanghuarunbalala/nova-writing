/**
 * LocationDetailPanel
 *
 * 地点详情面板（inspector 用，原型 .entity.detail-card + .loc-state）。
 *
 * 结构：e-head（e-av + e-name + e-role + loc-state）+ d-meta + e-note（profile）
 * + d-foot（"在内容中定位 ->" link 按钮）。
 */
import type { LocationDetail } from "../store/LocationStore.js";
import styles from "./LocationDetailPanel.module.css";

export interface LocationDetailPanelProps {
  readonly workspaceId: string;
  readonly locationId: string;
  readonly detail?: LocationDetail;
  readonly onLocateInContent?: (locationId: string) => void;
  /** 编辑入口（宿主打开编辑对话框） */
  readonly onEdit?: () => void;
  /** 删除入口（宿主确认后删除） */
  readonly onDelete?: () => void;
}

const STATE_LABEL: Record<LocationDetail["locState"], string> = {
  filed: "已建档",
  "draft-new": "草稿新增",
};

export function LocationDetailPanel({
  workspaceId,
  locationId,
  detail,
  onLocateInContent,
  onEdit,
  onDelete,
}: LocationDetailPanelProps) {
  if (detail === undefined) {
    return <div className={styles.panel}>加载地点详情…</div>;
  }
  const isDraft = detail.locState === "draft-new";
  return (
    <div className={styles.panel} data-workspace={workspaceId}>
      <div className={styles.head}>
        <span className={styles.av} aria-hidden="true">{detail.avatarText}</span>
        <span className={styles.meta}>
          <span className={styles.name}>{detail.name}</span>
          <span className={styles.role}>{detail.role}</span>
        </span>
        <span className={[styles.locState, isDraft ? styles.draft : ""].filter(Boolean).join(" ")}>
          {STATE_LABEL[detail.locState]}
        </span>
      </div>
      <div className={styles.dMeta}>{detail.locationId}</div>
      {detail.profile !== "" ? <p className={styles.note}>{detail.profile}</p> : null}
      <div className={styles.dFoot}>
        {onEdit !== undefined ? (
          <button type="button" className={styles.locate} onClick={onEdit}>
            编辑
          </button>
        ) : null}
        {onDelete !== undefined ? (
          <button type="button" className={styles.locate} onClick={onDelete}>
            删除
          </button>
        ) : null}
        {onLocateInContent !== undefined ? (
          <button
            type="button"
            className={styles.locate}
            onClick={() => onLocateInContent(locationId)}
          >
            在内容中定位 -&gt;
          </button>
        ) : null}
      </div>
    </div>
  );
}
