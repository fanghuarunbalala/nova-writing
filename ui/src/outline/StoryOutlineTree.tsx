/** Accessible flattened Outline tree presentation over local Controller state. */
import type { StoryOutlineTreeController } from "./StoryOutlineTreeController.js";
import { StoryOutlineTreeRow } from "./StoryOutlineTreeRow.js";
import { useStoryOutlineTree } from "./useStoryOutlineTree.js";

export interface StoryOutlineTreeProps {
  readonly controller: StoryOutlineTreeController;
  readonly onSelect?: (storyUnitId: string) => void;
}

export function StoryOutlineTree({ controller, onSelect }: StoryOutlineTreeProps) {
  const snapshot = useStoryOutlineTree(controller);
  const scopeLabel = snapshot.view.readScope.kind === "canonical" ? "已接受版本" : "草稿版本";
  return (
    <section className="novel-outline-tree-panel">
      <header className="novel-outline-tree-header">
        <div>
          <span>Story Outline</span>
          <h3>故事大纲</h3>
        </div>
        <span className="novel-outline-scope">{scopeLabel}</span>
      </header>
      {snapshot.visibleRows.length === 0 ? (
        <p className="novel-outline-empty">大纲中还没有故事单元。</p>
      ) : (
        <div className="novel-outline-tree" role="tree" aria-label="故事大纲树">
          {snapshot.visibleRows.map((row, index) => (
            <StoryOutlineTreeRow
              key={row.id}
              controller={controller}
              row={row}
              fallbackTabStop={snapshot.selectedId === undefined && index === 0}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </section>
  );
}
