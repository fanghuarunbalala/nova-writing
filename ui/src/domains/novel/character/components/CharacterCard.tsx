/**
 * CharacterCard
 *
 * 角色卡片（原型 .entity）：e-head（e-av + e-name/e-role）+ e-note + e-chips。
 *
 * e-av 用 accent 12% 浅底 + accent-ink 首字；e-chips 渲染 relatedUnits（暂为
 * 空，待 binding 查询落地后填充）。
 */
import type { CharacterSummary } from "../store/CharacterStore.js";
import styles from "./CharacterCard.module.css";

export interface CharacterCardProps {
  readonly character: CharacterSummary;
  readonly onSelect?: () => void;
}

export function CharacterCard({ character, onSelect }: CharacterCardProps) {
  return (
    <button type="button" className={styles.card} onClick={onSelect}>
      <div className={styles.head}>
        <span className={styles.av} aria-hidden="true">{character.avatarText}</span>
        <span className={styles.meta}>
          <span className={styles.name}>{character.name}</span>
          <span className={styles.role}>{character.role}</span>
        </span>
      </div>
      {character.note !== "" ? <p className={styles.note}>{character.note}</p> : null}
      {character.relatedUnits.length > 0 ? (
        <div className={styles.chips}>
          {character.relatedUnits.map((unit) => (
            <span key={unit}>{unit}</span>
          ))}
        </div>
      ) : null}
    </button>
  );
}
