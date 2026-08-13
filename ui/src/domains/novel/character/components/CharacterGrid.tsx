/**
 * CharacterGrid
 *
 * 角色网格容器 + 新建入口。
 */
import type { CharacterSummary } from "../store/CharacterStore.js";
import { Button } from "../../../../shared/primitives/index.js";
import { CharacterCard } from "./CharacterCard.js";
import styles from "./CharacterGrid.module.css";

export interface CharacterGridProps {
  readonly workspaceId: string;
  readonly characters: readonly CharacterSummary[];
  readonly onSelect?: (characterId: string) => void;
  /** 新建角色入口（宿主打开编辑对话框） */
  readonly onNewCharacter?: () => void;
}

export function CharacterGrid({ workspaceId, characters, onSelect, onNewCharacter }: CharacterGridProps) {
  return (
    <div data-workspace={workspaceId}>
      {onNewCharacter !== undefined ? (
        <div className={styles.toolbar}>
          <Button variant="secondary" size="sm" onClick={onNewCharacter}>
            ＋ 新建角色
          </Button>
        </div>
      ) : null}
      <div className={styles.grid}>
        {characters.map((character) => (
          <CharacterCard
            key={character.characterId}
            character={character}
            onSelect={() => onSelect?.(character.characterId)}
          />
        ))}
      </div>
    </div>
  );
}
