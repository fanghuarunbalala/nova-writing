/**
 * CharacterGrid
 *
 * 角色网格容器 + 新建入口。
 */
import { Plus, UserRound } from "lucide-react";
import type { CharacterSummary } from "../store/CharacterStore.js";
import { Button, EmptyState, Icon, LoadingState } from "../../../../shared/primitives/index.js";
import { CharacterCard } from "./CharacterCard.js";
import styles from "./CharacterGrid.module.css";

export interface CharacterGridProps {
  readonly workspaceId: string;
  readonly characters: readonly CharacterSummary[];
  readonly phase?: "idle" | "loading" | "ready" | "error";
  readonly onSelect?: (characterId: string) => void;
  /** 新建角色入口（宿主打开编辑对话框） */
  readonly onNewCharacter?: () => void;
}

export function CharacterGrid({ workspaceId, characters, phase, onSelect, onNewCharacter }: CharacterGridProps) {
  return (
    <div data-workspace={workspaceId}>
      {onNewCharacter !== undefined ? (
        <div className={styles.toolbar}>
          <Button variant="secondary" size="sm" leadingIcon={<Icon icon={Plus} size="sm" />} onClick={onNewCharacter}>
            新建角色
          </Button>
        </div>
      ) : null}
      {phase === "loading" ? (
        <LoadingState label="正在加载角色档案…" />
      ) : characters.length === 0 && (phase === undefined || phase === "ready") ? (
        <EmptyState
          icon={UserRound}
          title="还没有角色"
          description="在对话中让 Novel Agent 建立角色档案，或直接新建一个。"
          action={
            onNewCharacter !== undefined ? (
              <Button variant="secondary" size="sm" leadingIcon={<Icon icon={Plus} size="sm" />} onClick={onNewCharacter}>
                新建角色
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className={styles.grid}>
          {characters.map((character) => (
            <CharacterCard
              key={character.characterId}
              character={character}
              onSelect={() => onSelect?.(character.characterId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
