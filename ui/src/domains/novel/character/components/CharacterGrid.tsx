/**
 * CharacterGrid
 *
 * 角色网格容器。
 */
import type { CharacterSummary } from "../store/CharacterStore.js";
import { CharacterCard } from "./CharacterCard.js";
import styles from "./CharacterGrid.module.css";

export interface CharacterGridProps {
  readonly workspaceId: string;
  readonly characters: readonly CharacterSummary[];
  readonly onSelect?: (characterId: string) => void;
}

export function CharacterGrid({ workspaceId, characters, onSelect }: CharacterGridProps) {
  return (
    <div className={styles.grid} data-workspace={workspaceId}>
      {characters.map((character) => (
        <CharacterCard
          key={character.characterId}
          character={character}
          onSelect={() => onSelect?.(character.characterId)}
        />
      ))}
    </div>
  );
}
