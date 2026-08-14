/**
 * CharacterDetailPanel
 *
 * 角色详情面板（inspector 用，原型 .entity.detail-card）。
 *
 * 结构：e-head（e-av + e-name + e-role）+ d-meta（版本号）+ e-note（profile）
 * + d-foot（"在内容中定位 ->" link 按钮）。
 */
import { LocateFixed, Pencil, Trash2 } from "lucide-react";
import type { CharacterDetail } from "../store/CharacterStore.js";
import { Icon } from "../../../../shared/primitives/Icon.js";
import styles from "./CharacterDetailPanel.module.css";

export interface CharacterDetailPanelProps {
  readonly workspaceId: string;
  readonly characterId: string;
  readonly detail?: CharacterDetail;
  readonly onLocateInContent?: (characterId: string) => void;
  /** 编辑入口（宿主打开编辑对话框） */
  readonly onEdit?: () => void;
  /** 删除入口（宿主确认后删除） */
  readonly onDelete?: () => void;
}

export function CharacterDetailPanel({
  workspaceId,
  characterId,
  detail,
  onLocateInContent,
  onEdit,
  onDelete,
}: CharacterDetailPanelProps) {
  if (detail === undefined) {
    return <div className={styles.panel}>加载角色详情…</div>;
  }
  return (
    <div className={styles.panel} data-workspace={workspaceId}>
      <div className={styles.head}>
        <span className={styles.av} aria-hidden="true">{detail.avatarText}</span>
        <span className={styles.meta}>
          <span className={styles.name}>{detail.name}</span>
          <span className={styles.role}>{detail.role}</span>
        </span>
      </div>
      <div className={styles.dMeta}>v{detail.version}</div>
      {detail.profile !== "" ? <p className={styles.note}>{detail.profile}</p> : null}
      <div className={styles.dFoot}>
        {onEdit !== undefined ? (
          <button type="button" className={styles.locate} onClick={onEdit}>
            <Icon icon={Pencil} size="xs" />
            编辑
          </button>
        ) : null}
        {onDelete !== undefined ? (
          <button type="button" className={styles.locate} onClick={onDelete}>
            <Icon icon={Trash2} size="xs" />
            删除
          </button>
        ) : null}
        {onLocateInContent !== undefined ? (
          <button
            type="button"
            className={styles.locate}
            onClick={() => onLocateInContent(characterId)}
          >
            <Icon icon={LocateFixed} size="xs" />
            在内容中定位
          </button>
        ) : null}
      </div>
    </div>
  );
}
