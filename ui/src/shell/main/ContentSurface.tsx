/**
 * ContentSurface
 *
 * 内容视图：按侧栏选中的 pane（大纲/正文/人物/地点）渲染对应域内容；
 * 数据来自 novel 域 store。
 * 内容区用 .paneBody + .paneInner 包裹（原型 .pane-body + .pane-inner），
 * 提供 padding 与 max-width 1000 居中。
 */
import { useEffect, useState } from "react";
import { CharacterGrid } from "../../domains/novel/character/components/CharacterGrid.js";
import { LocationGrid } from "../../domains/novel/location/components/LocationGrid.js";
import { ManuscriptReader } from "../../domains/novel/manuscript/components/ManuscriptReader.js";
import { StoryOutlineTree } from "../../domains/novel/outline/components/StoryOutlineTree.js";
import { EntityEditDialog } from "../../domains/novel/components/EntityEditDialog.js";
import type { CharacterStore } from "../../domains/novel/character/store/CharacterStore.js";
import type { LocationStore } from "../../domains/novel/location/store/LocationStore.js";
import type { ManuscriptStructureStore } from "../../domains/novel/manuscript/store/ManuscriptStructureStore.js";
import type { StoryOutlineTreeStore } from "../../domains/novel/outline/store/StoryOutlineTreeStore.js";
import { useExternalStore } from "../../shared/state/useExternalStore.js";
import type { ContentTab } from "./contentTab.js";
import { MainSubHead } from "./MainSubHead.js";
import styles from "./ContentSurface.module.css";

const PANE_META: Record<ContentTab, { readonly title: string; readonly kicker: string }> = {
  outline: { title: "大纲", kicker: "故事单元 · 规划轴与实现轴" },
  manuscript: { title: "正文", kicker: "章节与正文块 · 草稿 / 正式稿" },
  characters: { title: "人物", kicker: "角色档案" },
  locations: { title: "地点", kicker: "地点档案" },
};

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
  readonly onOpenDraft?: (changeSetId: string) => void;
  readonly onBack?: () => void;
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
  onOpenDraft,
  onBack,
}: ContentSurfaceProps) {
  const outline = useExternalStore(outlineTree);
  const manuscriptSnapshot = useExternalStore(manuscript);
  const characterSnapshot = useExternalStore(characters);
  const locationSnapshot = useExternalStore(locations);
  const [characterDialogOpen, setCharacterDialogOpen] = useState(false);
  const [locationDialogOpen, setLocationDialogOpen] = useState(false);

  // 定位：来自对话引用的章节/段落自动选中所属章节。
  useEffect(() => {
    if (locateReference == null) return;
    if (locateReference.kind === "chapter") {
      manuscript.selectChapter(locateReference.id);
    } else {
      const chapter = manuscript.getSnapshot().chapters.find((c) =>
        c.paragraphIds.includes(locateReference.id),
      );
      if (chapter !== undefined) manuscript.selectChapter(chapter.chapterId);
    }
  }, [manuscript, locateReference]);

  const renderTab = (tab: ContentTab) => {
    // 正文阅读器：双栏各自独立滚动，不走 1000px 居中列。
    if (tab === "manuscript") {
      const content = (
        <ManuscriptReader
          workspaceId={workspaceId ?? ""}
          snapshot={manuscriptSnapshot}
          onSelectChapter={(chapterId) => manuscript.selectChapter(chapterId)}
          locate={locateReference}
          onOpenDraft={onOpenDraft}
          onInsertParagraph={(storyUnitId) =>
            void manuscript.insertParagraph(storyUnitId, "")
          }
          onSaveParagraph={(paragraphId, text) => {
            const version = manuscript.getParagraphVersion(paragraphId);
            if (version === undefined) return;
            return manuscript.updateParagraph(paragraphId, text, version);
          }}
          onDeleteParagraph={(paragraphId) => {
            const version = manuscript.getParagraphVersion(paragraphId);
            if (version === undefined) return;
            // eslint-disable-next-line no-alert
            if (!window.confirm("确定删除该段落？此操作不可撤销。")) return;
            void manuscript.deleteParagraph(paragraphId, version);
          }}
        />
      );
      return <div className={styles.readerBody}>{content}</div>;
    }
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
      case "characters":
        content = (
          <CharacterGrid
            workspaceId={workspaceId ?? ""}
            characters={characterSnapshot.characters}
            onSelect={onSelectCharacter}
            onNewCharacter={() => setCharacterDialogOpen(true)}
          />
        );
        break;
      case "locations":
        content = (
          <LocationGrid
            workspaceId={workspaceId ?? ""}
            locations={locationSnapshot.locations}
            onSelect={onSelectLocation}
            onNewLocation={() => setLocationDialogOpen(true)}
          />
        );
        break;
    }
    return <div className={styles.paneBody}><div className={styles.paneInner}>{content}</div></div>;
  };
  return (
    <div className={styles.surface}>
      <MainSubHead title={PANE_META[value].title} sub={PANE_META[value].kicker} onBack={onBack} />
      {renderTab(value)}
      <EntityEditDialog
        open={characterDialogOpen}
        onOpenChange={setCharacterDialogOpen}
        entityLabel="角色"
        error={characterSnapshot.error?.message}
        onSubmit={(input) => characters.createCharacter(input)}
      />
      <EntityEditDialog
        open={locationDialogOpen}
        onOpenChange={setLocationDialogOpen}
        entityLabel="地点"
        error={locationSnapshot.error?.message}
        onSubmit={(input) => locations.createLocation(input)}
      />
    </div>
  );
}
