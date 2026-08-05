/**
 * LocationCard
 *
 * 地点卡片：头像 + 名字 + 状态 + 简介。
 */
import { Avatar } from "../../../../shared/primitives/Avatar.js";
import type { LocationSummary } from "../store/LocationStore.js";
import styles from "./LocationCard.module.css";

export interface LocationCardProps {
  readonly location: LocationSummary;
  readonly onSelect?: () => void;
}

export function LocationCard({ location, onSelect }: LocationCardProps) {
  return (
    <button type="button" className={styles.card} onClick={onSelect}>
      <Avatar variant="user" text={location.avatarText} size="md" />
      <span className={styles.body}>
        <span className={styles.name}>
          {location.name}
          <span className={[styles.state, location.locState === "draft-new" ? styles.draft : ""].filter(Boolean).join(" ")}>
            {location.locState === "filed" ? "已建档" : "草稿新增"}
          </span>
        </span>
        <span className={styles.role}>{location.role}</span>
        {location.note !== "" ? <span className={styles.note}>{location.note}</span> : null}
      </span>
    </button>
  );
}
