/** Accessible flattened Outline tree presentation over local Controller state. */
import {
  ReferenceInConversationButton,
  type ComposerContentReference,
} from "../composer/index.js";
import type { StoryOutlineTreeController } from "./StoryOutlineTreeController.js";
import { StoryOutlineTreeRow } from "./StoryOutlineTreeRow.js";
import type {
  StoryOutlineTreeView,
  StoryUnitTreeNodeView,
} from "./StoryOutlineTreeView.js";
import { useStoryOutlineTree } from "./useStoryOutlineTree.js";

export interface StoryOutlineTreeProps {
  readonly controller: StoryOutlineTreeController;
  readonly onSelect?: (storyUnitId: string) => void;
  readonly referenceForStoryUnit?: (
    node: StoryUnitTreeNodeView,
    view: StoryOutlineTreeView,
  ) => ComposerContentReference | undefined;
}

export function StoryOutlineTree({
  controller,
  onSelect,
  referenceForStoryUnit,
}: StoryOutlineTreeProps) {
  const snapshot = useStoryOutlineTree(controller);
  const scopeLabel = snapshot.view.readScope.kind === "canonical" ? "已接受版本" : "草稿版本";
  const selectedNode = snapshot.selectedId === undefined
    ? undefined
    : snapshot.view.nodes[snapshot.selectedId];
  const selectedReference =
    selectedNode === undefined || referenceForStoryUnit === undefined
      ? undefined
      : referenceForStoryUnit(selectedNode, snapshot.view);
  return (
    <section className="novel-outline-tree-panel">
      <header className="novel-outline-tree-header">
        <div>
          <span>Story Outline</span>
          <h3>故事大纲</h3>
        </div>
        <div className="novel-outline-tree-actions">
          <span className="novel-outline-scope">{scopeLabel}</span>
          {selectedReference !== undefined ? (
            <ReferenceInConversationButton reference={selectedReference} />
          ) : null}
        </div>
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
