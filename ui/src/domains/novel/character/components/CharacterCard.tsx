/**
 * CharacterCard
 *
 * 角色卡片：头像 + 名字 + 角色 + 简介。
 */
import { Avatar } from "../../../../shared/primitives/Avatar.js";
import type { CharacterSummary } from "../store/CharacterStore.js";
import styles from "./CharacterCard.module.css";

export interface CharacterCardProps {
  readonly character: CharacterSummary;
  readonly onSelect?: () => void;
}

export function CharacterCard({ character, onSelect }: CharacterCardProps) {
  return (
    <button type="button" className={styles.card} onClick={onSelect}>
      <Avatar variant="user" text={character.avatarText} size="md" />
      <span className={styles.body}>
        <span className={styles.name}>{character.name}</span>
        <span className={styles.role}>{character.role}</span>
        {character.note !== "" ? <span className={styles.note}>{character.note}</span> : null}
      </span>
    </button>
  );
}
