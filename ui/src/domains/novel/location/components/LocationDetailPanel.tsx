/**
 * LocationDetailPanel
 *
 * 地点详情面板（inspector 用）。
 */
import { Avatar } from "../../../../shared/primitives/Avatar.js";
import type { LocationDetail } from "../store/LocationStore.js";
import styles from "./LocationDetailPanel.module.css";

export interface LocationDetailPanelProps {
  readonly workspaceId: string;
  readonly locationId: string;
  readonly detail?: LocationDetail;
  readonly onLocateInContent?: (locationId: string) => void;
}

export function LocationDetailPanel({
  workspaceId,
  locationId,
  detail,
  onLocateInContent,
}: LocationDetailPanelProps) {
  if (detail === undefined) {
    return <div className={styles.panel}>加载地点详情…</div>;
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
        <button type="button" className={styles.locate} onClick={() => onLocateInContent(locationId)}>
          在内容中定位
        </button>
      ) : null}
    </div>
  );
}
