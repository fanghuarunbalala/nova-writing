/**
 * CharacterDetailPanel
 *
 * 角色详情面板（inspector 用，原型 .entity.detail-card）。
 *
 * 结构：e-head（e-av + e-name + e-role）+ d-meta（版本号）+ e-note（profile）
 * + d-foot（"在内容中定位 ->" link 按钮）。
 */
import type { CharacterDetail } from "../store/CharacterStore.js";
import styles from "./CharacterDetailPanel.module.css";

export interface CharacterDetailPanelProps {
  readonly workspaceId: string;
  readonly characterId: string;
  readonly detail?: CharacterDetail;
  readonly onLocateInContent?: (characterId: string) => void;
}

export function CharacterDetailPanel({
  workspaceId,
  characterId,
  detail,
  onLocateInContent,
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
      {onLocateInContent !== undefined ? (
        <div className={styles.dFoot}>
          <button
            type="button"
            className={styles.locate}
            onClick={() => onLocateInContent(characterId)}
          >
            在内容中定位 -&gt;
          </button>
        </div>
      ) : null}
    </div>
  );
}
