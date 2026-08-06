/**
 * ContentSurface
 *
 * 内容视图：按侧栏选中的 pane（大纲/正文/人物/地点）渲染对应域内容；
 * 数据来自 novel 域 store。
 * 内容区用 .paneBody + .paneInner 包裹（原型 .pane-body + .pane-inner），
 * 提供 padding 与 max-width 1000 居中。
 */
import { CharacterGrid } from "../../domains/novel/character/components/CharacterGrid.js";
import { LocationGrid } from "../../domains/novel/location/components/LocationGrid.js";
import { ManuscriptChapterList } from "../../domains/novel/manuscript/components/ManuscriptChapterList.js";
import { StoryOutlineTree } from "../../domains/novel/outline/components/StoryOutlineTree.js";
import type { CharacterStore } from "../../domains/novel/character/store/CharacterStore.js";
import type { LocationStore } from "../../domains/novel/location/store/LocationStore.js";
import type { ManuscriptStructureStore } from "../../domains/novel/manuscript/store/ManuscriptStructureStore.js";
import type { StoryOutlineTreeStore } from "../../domains/novel/outline/store/StoryOutlineTreeStore.js";
import { useExternalStore } from "../../shared/state/useExternalStore.js";
import type { ContentTab } from "./contentTab.js";
import styles from "./ContentSurface.module.css";

export interface ContentSurfaceProps {
  readonly workspaceId: string | undefined;
  readonly value: ContentTab;
  readonly outlineTree: StoryOutlineTreeStore;
  readonly manuscript: ManuscriptStructureStore;
  readonly characters: CharacterStore;
  readonly locations: LocationStore;
  readonly onSelectOutlineUnit?: (unitId: string) => void;
  readonly onSelectCharacter?: (characterId: string) => void;
  readonly onSelectLocation?: (locationId: string) => void;
  readonly locateReference?: { readonly kind: "chapter" | "paragraph"; readonly id: string; readonly nonce: number } | null;
}

export function ContentSurface({
  workspaceId,
  value,
  outlineTree,
  manuscript,
  characters,
  locations,
  onSelectOutlineUnit,
  onSelectCharacter,
  onSelectLocation,
  locateReference,
}: ContentSurfaceProps) {
  const outline = useExternalStore(outlineTree);
  const manuscriptSnapshot = useExternalStore(manuscript);
  const characterSnapshot = useExternalStore(characters);
  const locationSnapshot = useExternalStore(locations);
  const renderTab = (tab: ContentTab) => {
    let content;
    switch (tab) {
      case "outline":
        content = (
          <StoryOutlineTree
            workspaceId={workspaceId ?? ""}
            tree={outline.tree}
            expansionState={outline.expansionState}
            selectedUnitId={outline.selectedUnitId}
            onSelectUnit={onSelectOutlineUnit}
            onToggleExpand={(id) => outlineTree.toggleExpand(id)}
          />
        );
        break;
      case "manuscript":
        content = (
          <ManuscriptChapterList
            workspaceId={workspaceId ?? ""}
            chapters={manuscriptSnapshot.chapters}
            locate={
              locateReference == null
                ? undefined
                : { kind: locateReference.kind, id: locateReference.id, nonce: locateReference.nonce }
            }
          />
        );
        break;
      case "characters":
        content = (
          <CharacterGrid
            workspaceId={workspaceId ?? ""}
            characters={characterSnapshot.characters}
            onSelect={onSelectCharacter}
          />
        );
        break;
      case "locations":
        content = (
          <LocationGrid
            workspaceId={workspaceId ?? ""}
            locations={locationSnapshot.locations}
            onSelect={onSelectLocation}
          />
        );
        break;
    }
    return <div className={styles.paneBody}><div className={styles.paneInner}>{content}</div></div>;
  };
  return (
    <div className={styles.surface}>
      {renderTab(value)}
    </div>
  );
}
