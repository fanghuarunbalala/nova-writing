/**
 * CharacterDetailPanel
 *
 * 角色详情面板（inspector 用）。
 */
import { Avatar } from "../../../../shared/primitives/Avatar.js";
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
      <header className={styles.head}>
        <Avatar variant="user" text={detail.avatarText} size="md" />
        <div>
          <h3 className={styles.name}>{detail.name}</h3>
          <span className={styles.role}>{detail.role}</span>
        </div>
      </header>
      {detail.profile !== "" ? <p className={styles.profile}>{detail.profile}</p> : null}
      {onLocateInContent !== undefined ? (
        <button type="button" className={styles.locate} onClick={() => onLocateInContent(characterId)}>
          在内容中定位
        </button>
      ) : null}
    </div>
  );
}
