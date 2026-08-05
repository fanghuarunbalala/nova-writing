/**
 * LocationCard
 *
 * 地点卡片（原型 .entity + .loc-state）：e-head（e-av + e-name/e-role +
 * loc-state）+ e-note + e-chips。
 *
 * loc-state 在 head 末尾 margin-left:auto，filed 用 success 色，draft-new
 * 用 warn 色。
 */
import type { LocationSummary } from "../store/LocationStore.js";
import styles from "./LocationCard.module.css";

export interface LocationCardProps {
  readonly location: LocationSummary;
  readonly onSelect?: () => void;
}

const STATE_LABEL: Record<LocationSummary["locState"], string> = {
  filed: "已建档",
  "draft-new": "草稿新增",
};

export function LocationCard({ location, onSelect }: LocationCardProps) {
  const isDraft = location.locState === "draft-new";
  return (
    <button type="button" className={styles.card} onClick={onSelect}>
      <div className={styles.head}>
        <span className={styles.av} aria-hidden="true">{location.avatarText}</span>
        <span className={styles.meta}>
          <span className={styles.name}>{location.name}</span>
          <span className={styles.role}>{location.role}</span>
        </span>
        <span className={[styles.locState, isDraft ? styles.draft : ""].filter(Boolean).join(" ")}>
          {STATE_LABEL[location.locState]}
        </span>
      </div>
      {location.note !== "" ? <p className={styles.note}>{location.note}</p> : null}
      {location.relatedUnits.length > 0 ? (
        <div className={styles.chips}>
          {location.relatedUnits.map((unit) => (
            <span key={unit}>{unit}</span>
          ))}
        </div>
      ) : null}
    </button>
  );
}
