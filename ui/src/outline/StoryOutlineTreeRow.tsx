/** One accessible flattened StoryUnit tree row with local expansion controls. */
import type { CSSProperties, KeyboardEvent } from "react";
import type {
  StoryOutlineTreeController,
  VisibleStoryUnitRow,
} from "./StoryOutlineTreeController.js";
import { StoryOutlineTreeStatus } from "./StoryOutlineTreeStatus.js";

export interface StoryOutlineTreeRowProps {
  readonly controller: StoryOutlineTreeController;
  readonly row: VisibleStoryUnitRow;
  readonly fallbackTabStop: boolean;
  readonly onSelect?: (storyUnitId: string) => void;
}

export function StoryOutlineTreeRow({
  controller,
  row,
  fallbackTabStop,
  onSelect,
}: StoryOutlineTreeRowProps) {
  const style = {
    "--novel-outline-indent": `${row.depth * 18}px`,
  } as CSSProperties;

  function select(): void {
    const previousId = controller.getSnapshot().selectedId;
    controller.select(row.id);
    if (previousId !== row.id) onSelect?.(row.id);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const previousId = controller.getSnapshot().selectedId;
    const tree = event.currentTarget.parentElement;
    let handled = true;
    switch (event.key) {
      case "ArrowDown":
        controller.selectNext();
        break;
      case "ArrowUp":
        controller.selectPrevious();
        break;
      case "ArrowRight":
        if (row.expandable && !row.expanded) controller.expand(row.id);
        else controller.selectFirstChild();
        break;
      case "ArrowLeft":
        if (row.expanded) controller.collapse(row.id);
        else controller.selectParent();
        break;
      case "Enter":
      case " ":
        controller.select(row.id);
        break;
      default:
        handled = false;
    }
    if (!handled) return;
    event.preventDefault();
    const selectedId = controller.getSnapshot().selectedId;
    if (selectedId !== undefined && selectedId !== previousId) {
      onSelect?.(selectedId);
      queueMicrotask(() => {
        const selectedRow = [...(tree?.querySelectorAll<HTMLElement>("[data-story-unit-id]") ?? [])]
          .find((candidate) => candidate.dataset.storyUnitId === selectedId);
        selectedRow?.focus();
      });
    }
  }

  return (
    <div
      className="novel-outline-row"
      data-story-unit-id={row.id}
      data-selected={row.selected}
      role="treeitem"
      aria-level={row.depth + 1}
      aria-posinset={row.positionInSet}
      aria-setsize={row.setSize}
      aria-selected={row.selected}
      {...(row.expandable ? { "aria-expanded": row.expanded } : {})}
      tabIndex={row.selected || fallbackTabStop ? 0 : -1}
      style={style}
      onClick={select}
      onFocus={select}
      onKeyDown={handleKeyDown}
    >
      <button
        className="novel-outline-toggle"
        type="button"
        aria-label={row.expanded ? "折叠故事单元" : "展开故事单元"}
        disabled={!row.expandable}
        tabIndex={-1}
        onClick={(event) => {
          event.stopPropagation();
          controller.toggle(row.id);
        }}
      >
        {row.expandable ? (row.expanded ? "▾" : "▸") : "·"}
      </button>
      <span className="novel-outline-row-main">
        <span className="novel-outline-title">{row.node.title}</span>
        <StoryOutlineTreeStatus node={row.node} />
      </span>
    </div>
  );
}
