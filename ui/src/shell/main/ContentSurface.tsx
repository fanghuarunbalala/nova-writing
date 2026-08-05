/**
 * ContentSurface
 *
 * 内容视图：四 tab（大纲/正文/角色/地点），数据来自 novel 域 store。
 */
import { CharacterGrid } from "../../domains/novel/character/components/CharacterGrid.js";
import { LocationGrid } from "../../domains/novel/location/components/LocationGrid.js";
import { ManuscriptChapterList } from "../../domains/novel/manuscript/components/ManuscriptChapterList.js";
import { StoryOutlineTree } from "../../domains/novel/outline/components/StoryOutlineTree.js";
import type { CharacterStore } from "../../domains/novel/character/store/CharacterStore.js";
import type { LocationStore } from "../../domains/novel/location/store/LocationStore.js";
import type { ManuscriptStructureStore } from "../../domains/novel/manuscript/store/ManuscriptStructureStore.js";
import type { StoryOutlineTreeStore } from "../../domains/novel/outline/store/StoryOutlineTreeStore.js";
import { useState } from "react";
import { useExternalStore } from "../../shared/state/useExternalStore.js";
import { ContentTabs, type ContentTab } from "./ContentTabs.js";
import styles from "./ContentSurface.module.css";

export interface ContentSurfaceProps {
  readonly workspaceId: string | undefined;
  readonly outlineTree: StoryOutlineTreeStore;
  readonly manuscript: ManuscriptStructureStore;
  readonly characters: CharacterStore;
  readonly locations: LocationStore;
  readonly onSelectOutlineUnit?: (unitId: string) => void;
  readonly onSelectCharacter?: (characterId: string) => void;
  readonly onSelectLocation?: (locationId: string) => void;
}

export function ContentSurface({
  workspaceId,
  outlineTree,
  manuscript,
  characters,
  locations,
  onSelectOutlineUnit,
  onSelectCharacter,
  onSelectLocation,
}: ContentSurfaceProps) {
  const outline = useExternalStore(outlineTree);
  const manuscriptSnapshot = useExternalStore(manuscript);
  const characterSnapshot = useExternalStore(characters);
  const locationSnapshot = useExternalStore(locations);
  const [tab, setTab] = useState<ContentTab>("outline");
  const renderTab = (tab: ContentTab) => {
    switch (tab) {
      case "outline":
        return (
          <StoryOutlineTree
            workspaceId={workspaceId ?? ""}
            tree={outline.tree}
            expansionState={outline.expansionState}
            selectedUnitId={outline.selectedUnitId}
            onSelectUnit={onSelectOutlineUnit}
            onToggleExpand={(id) => outlineTree.toggleExpand(id)}
          />
        );
      case "manuscript":
        return (
          <ManuscriptChapterList
            workspaceId={workspaceId ?? ""}
            chapters={manuscriptSnapshot.chapters}
          />
        );
      case "characters":
        return (
          <CharacterGrid
            workspaceId={workspaceId ?? ""}
            characters={characterSnapshot.characters}
            onSelect={onSelectCharacter}
          />
        );
      case "locations":
        return (
          <LocationGrid
            workspaceId={workspaceId ?? ""}
            locations={locationSnapshot.locations}
            onSelect={onSelectLocation}
          />
        );
    }
  };
  return (
    <div className={styles.surface}>
      <ContentTabs value={tab} onChange={setTab}>
        {renderTab}
      </ContentTabs>
    </div>
  );
}
