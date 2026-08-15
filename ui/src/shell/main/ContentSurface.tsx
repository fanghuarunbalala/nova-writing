/**
 * ContentSurface
 *
 * 内容视图（PRD §7）：目录在侧栏（大纲树/卷章/人物/地点），主区按资料位渲染——
 *   outline    = 选中单元详情（OutlineUnitInspectorPanel 复用，PRD OL-2~7）；
 *   manuscript = 双栏阅读器（左目录右正文，保留现实现，PRD MS-1）；
 *   characters = 角色档案详情（EntityInspectorPanel 复用，PRD PM）；
 *   locations  = 地点档案详情（同上，PRD PL）。
 * 新建角色/地点对话框从主区操作区触发（原 Grid 入口移除）。
 */
import { useEffect, useState, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { ManuscriptReader } from "../../domains/novel/manuscript/components/ManuscriptReader.js";
import { EntityEditDialog } from "../../domains/novel/components/EntityEditDialog.js";
import type { CharacterStore } from "../../domains/novel/character/store/CharacterStore.js";
import type { LocationStore } from "../../domains/novel/location/store/LocationStore.js";
import type { ManuscriptStructureStore } from "../../domains/novel/manuscript/store/ManuscriptStructureStore.js";
import type { StoryOutlineTreeStore } from "../../domains/novel/outline/store/StoryOutlineTreeStore.js";
import { useExternalStore } from "../../shared/state/useExternalStore.js";
import { Button } from "../../shared/primitives/Button.js";
import { Icon } from "../../shared/primitives/Icon.js";
import { ConfirmDialog } from "../../shared/primitives/ConfirmDialog.js";
import { OutlineUnitInspectorPanel } from "../inspector/panels/OutlineUnitInspectorPanel.js";
import { EntityInspectorPanel } from "../inspector/panels/EntityInspectorPanel.js";
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
  /** 档案选区（壳持有；目录在侧栏、详情在此渲染） */
  readonly selectedCharacterId?: string;
  readonly selectedLocationId?: string;
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
  selectedCharacterId,
  selectedLocationId,
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
  const [deleteParagraphId, setDeleteParagraphId] = useState<string | undefined>(undefined);

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

  const renderTab = (tab: ContentTab): ReactNode => {
    // 正文阅读器：双栏各自独立滚动，不走居中列。
    if (tab === "manuscript") {
      return (
        <div className={styles.readerBody}>
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
              setDeleteParagraphId(paragraphId);
            }}
          />
        </div>
      );
    }
    let content: ReactNode;
    let actions: ReactNode = null;
    switch (tab) {
      case "outline":
        // 大纲树在侧栏；主区 = 选中单元详情（无选中给引导空态）。
        content =
          outline.selectedUnitId !== undefined ? (
            <OutlineUnitInspectorPanel
              workspaceId={workspaceId ?? ""}
              unitId={outline.selectedUnitId}
              outlineTree={outlineTree}
            />
          ) : (
            <div className={styles.emptyPane}>
              在左侧大纲树选择一个单元，这里显示它的规划 / 实现状态与关联。
            </div>
          );
        break;
      case "characters": {
        const effectiveId =
          selectedCharacterId ?? characterSnapshot.characters[0]?.characterId;
        content =
          effectiveId !== undefined ? (
            <EntityInspectorPanel
              workspaceId={workspaceId ?? ""}
              entityType="character"
              entityId={effectiveId}
              characters={characters}
              locations={locations}
            />
          ) : (
            <div className={styles.emptyPane}>
              尚无角色档案——让助理在对话中建档，或点右上「新建角色」。
            </div>
          );
        actions = (
          <Button
            variant="secondary"
            leadingIcon={<Icon icon={Plus} size="sm" />}
            onClick={() => setCharacterDialogOpen(true)}
          >
            新建角色
          </Button>
        );
        break;
      }
      case "locations":
      default: {
        const effectiveId = selectedLocationId ?? locationSnapshot.locations[0]?.locationId;
        content =
          effectiveId !== undefined ? (
            <EntityInspectorPanel
              workspaceId={workspaceId ?? ""}
              entityType="location"
              entityId={effectiveId}
              characters={characters}
              locations={locations}
            />
          ) : (
            <div className={styles.emptyPane}>
              尚无地点档案——让助理在对话中建档，或点右上「新建地点」。
            </div>
          );
        actions = (
          <Button
            variant="secondary"
            leadingIcon={<Icon icon={Plus} size="sm" />}
            onClick={() => setLocationDialogOpen(true)}
          >
            新建地点
          </Button>
        );
        break;
      }
    }
    return (
      <>
        <MainSubHead
          title={PANE_META[tab].title}
          sub={PANE_META[tab].kicker}
          onBack={onBack}
          actions={actions}
        />
        <div className={styles.paneBody}>
          <div className={styles.paneInner}>{content}</div>
        </div>
      </>
    );
  };
  return (
    <div className={styles.surface}>
      {value === "manuscript" ? (
        <MainSubHead title={PANE_META[value].title} sub={PANE_META[value].kicker} onBack={onBack} />
      ) : null}
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
      <ConfirmDialog
        open={deleteParagraphId !== undefined}
        onOpenChange={(open) => {
          if (!open) setDeleteParagraphId(undefined);
        }}
        title="删除段落"
        description="确定删除该段落？此操作不可撤销。"
        onConfirm={() => {
          const paragraphId = deleteParagraphId;
          setDeleteParagraphId(undefined);
          if (paragraphId === undefined) return;
          const version = manuscript.getParagraphVersion(paragraphId);
          if (version === undefined) return;
          void manuscript.deleteParagraph(paragraphId, version);
        }}
      />
    </div>
  );
}
