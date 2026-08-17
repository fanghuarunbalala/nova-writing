/**
 * ContentSurface
 *
 * 内容视图（PRD §7）：目录在侧栏（大纲树/卷章/人物/地点），主区按资料位渲染——
 *   outline    = 选中单元详情（OutlineUnitInspectorPanel 复用，PRD OL-2~7）；
 *   manuscript = 章阅读区（MS-1~5：卷章目录在左栏，此处仅阅读区；章头元信息
 *                与受阻/弃置状态由大纲树快照派生注入）；
 *   characters = 角色档案详情（EntityInspectorPanel 复用，PRD PM）；
 *   locations  = 地点档案详情（同上，PRD PL）。
 * subHead：subCtx 显示当前选中项；大纲 pane 动作 = 展开全部 + 新建单元，
 * 正文 pane 动作 = 复制正文；新建角色/地点对话框从主区操作区触发。
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronsDownUp, ChevronsUpDown, Copy, Plus } from "lucide-react";
import { ManuscriptReader } from "../../domains/novel/manuscript/components/ManuscriptReader.js";
import { EntityEditDialog } from "../../domains/novel/components/EntityEditDialog.js";
import type { CharacterStore } from "../../domains/novel/character/store/CharacterStore.js";
import type { LocationStore } from "../../domains/novel/location/store/LocationStore.js";
import type { ManuscriptStructureStore } from "../../domains/novel/manuscript/store/ManuscriptStructureStore.js";
import type { StoryOutlineTreeStore } from "../../domains/novel/outline/store/StoryOutlineTreeStore.js";
import type { StoryOutlineTreeNode } from "../../domains/novel/outline/projection/StoryOutlineTreeProjection.js";
import { StoryUnitEditDialog } from "../../domains/novel/outline/components/StoryUnitEditDialog.js";
import { useExternalStore } from "../../shared/state/useExternalStore.js";
import type { ToastKind } from "../../shared/state/ToastStore.js";
import { Button, ConfirmDialog, Icon } from "../../shared/primitives/index.js";
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
  /** 切资料位（「在正文中查看」跳正文阅读器） */
  readonly onSelectContentPane?: (pane: ContentTab) => void;
  /** 跳人物/地点档案（详情面板 leaf chips） */
  readonly onOpenCharacter?: (characterId: string) => void;
  readonly onOpenLocation?: (locationId: string) => void;
  /** toast（复制正文反馈） */
  readonly onNotify?: (kind: ToastKind, text: string) => void;
}

function findOutlineTitle(
  nodes: readonly StoryOutlineTreeNode[],
  unitId: string | undefined,
): string | undefined {
  if (unitId === undefined) return undefined;
  for (const node of nodes) {
    if (node.unitId === unitId) return node.title;
    const child = findOutlineTitle(node.children, unitId);
    if (child !== undefined) return child;
  }
  return undefined;
}

/** storyUnitId → 树节点（章状态派生：realization + 受阻/弃置原因） */
function collectOutlineUnits(
  nodes: readonly StoryOutlineTreeNode[],
  into: Map<string, StoryOutlineTreeNode>,
): void {
  for (const node of nodes) {
    into.set(node.unitId, node);
    collectOutlineUnits(node.children, into);
  }
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
  onSelectContentPane,
  onOpenCharacter,
  onOpenLocation,
  onNotify,
}: ContentSurfaceProps) {
  const outline = useExternalStore(outlineTree);
  const manuscriptSnapshot = useExternalStore(manuscript);
  const characterSnapshot = useExternalStore(characters);
  const locationSnapshot = useExternalStore(locations);
  const [characterDialogOpen, setCharacterDialogOpen] = useState(false);
  const [locationDialogOpen, setLocationDialogOpen] = useState(false);
  const [unitDialogOpen, setUnitDialogOpen] = useState(false);
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

  const selectedChapter = manuscriptSnapshot.chapters.find(
    (chapter) => chapter.chapterId === manuscriptSnapshot.selectedChapterId,
  );
  const effectiveCharacter =
    characterSnapshot.characters.find((c) => c.characterId === selectedCharacterId) ??
    characterSnapshot.characters[0];
  const effectiveLocation =
    locationSnapshot.locations.find((l) => l.locationId === selectedLocationId) ??
    locationSnapshot.locations[0];
  const characterNames = useMemo(
    () =>
      new Map(
        characterSnapshot.characters.map((c) => [c.characterId, { name: c.name }] as const),
      ),
    [characterSnapshot.characters],
  );
  const locationNames = useMemo(
    () =>
      new Map(
        locationSnapshot.locations.map((l) => [l.locationId, { name: l.name }] as const),
      ),
    [locationSnapshot.locations],
  );
  // 正文阅读区派生数据：chapterId → 卷名；chapterId → 大纲树节点状态。
  const unitByChapter = useMemo(() => {
    const unitById = new Map<string, StoryOutlineTreeNode>();
    collectOutlineUnits(outline.tree, unitById);
    const map = new Map<string, StoryOutlineTreeNode>();
    for (const chapter of manuscriptSnapshot.chapters) {
      if (chapter.storyUnitId === undefined) continue;
      const unit = unitById.get(chapter.storyUnitId);
      if (unit !== undefined) map.set(chapter.chapterId, unit);
    }
    return map;
  }, [outline.tree, manuscriptSnapshot.chapters]);
  const volumeTitleByChapter = useMemo(() => {
    const map = new Map<string, string>();
    for (const volume of manuscriptSnapshot.volumes) {
      for (const chapter of volume.chapters) map.set(chapter.chapterId, volume.title);
    }
    return map;
  }, [manuscriptSnapshot.volumes]);

  const handleCopyChapter = async (): Promise<void> => {
    if (selectedChapter === undefined) return;
    const text = selectedChapter.blocks.map((block) => block.text).join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
      onNotify?.("success", `已复制「${selectedChapter.title}」正文`);
    } catch {
      onNotify?.("warn", "复制失败：剪贴板不可用");
    }
  };

  const handleOpenChapter = (chapterId: string): void => {
    manuscript.selectChapter(chapterId);
    onSelectContentPane?.("manuscript");
  };

  // 档案「关联单元」chip → 选中大纲单元并切到大纲资料位。
  const handleOpenUnit = (unitId: string): void => {
    outlineTree.selectUnit(unitId);
    onSelectContentPane?.("outline");
  };

  const renderTab = (tab: ContentTab): ReactNode => {
    // 正文阅读器：双栏各自独立滚动，不走居中列。
    if (tab === "manuscript") {
      return (
        <div className={styles.readerBody}>
          <ManuscriptReader
            workspaceId={workspaceId ?? ""}
            snapshot={manuscriptSnapshot}
            volumeTitleOf={(chapterId) => volumeTitleByChapter.get(chapterId)}
            chapterStatusOf={(chapterId) => {
              const unit = unitByChapter.get(chapterId);
              return unit === undefined
                ? undefined
                : {
                    realization: unit.realization,
                    blockedReason: unit.blockedReason,
                    abandonedReason: unit.abandonedReason,
                  };
            }}
            locate={locateReference}
            onOpenDraft={onOpenDraft}
            onInsertParagraph={(chapterId) =>
              void manuscript.insertParagraph(chapterId, "")
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
    let context: string | undefined;
    switch (tab) {
      case "outline": {
        // 大纲树在侧栏；主区 = 选中单元详情（无选中给引导空态）。
        context = findOutlineTitle(outline.tree, outline.selectedUnitId);
        content =
          outline.selectedUnitId !== undefined ? (
            <OutlineUnitInspectorPanel
              workspaceId={workspaceId ?? ""}
              unitId={outline.selectedUnitId}
              outlineTree={outlineTree}
              chapters={manuscriptSnapshot.chapters}
              unitParagraphs={manuscriptSnapshot.unitParagraphs.get(outline.selectedUnitId) ?? []}
              publishedParagraphIds={manuscriptSnapshot.publishedParagraphIds}
              characterNames={characterNames}
              locationNames={locationNames}
              onOpenChapter={onSelectContentPane !== undefined ? handleOpenChapter : undefined}
              onDiscuss={onBack}
              onOpenCharacter={onOpenCharacter}
              onOpenLocation={onOpenLocation}
            />
          ) : (
            <div className={styles.emptyPane}>
              在左侧大纲树选择一个单元，这里显示它的规划 / 实现状态与关联。
            </div>
          );
        actions =
          outline.tree.length > 0 ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                leadingIcon={<Icon icon={ChevronsUpDown} size="xs" />}
                onClick={() => outlineTree.expandAll()}
              >
                展开全部
              </Button>
              <Button
                variant="secondary"
                size="sm"
                leadingIcon={<Icon icon={Plus} size="xs" />}
                onClick={() => setUnitDialogOpen(true)}
              >
                新建单元
              </Button>
            </>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              leadingIcon={<Icon icon={Plus} size="xs" />}
              onClick={() => setUnitDialogOpen(true)}
            >
              新建单元
            </Button>
          );
        break;
      }
      case "characters": {
        context =
          effectiveCharacter !== undefined
            ? `${effectiveCharacter.name} · ${effectiveCharacter.role}`
            : undefined;
        content =
          effectiveCharacter !== undefined ? (
            <EntityInspectorPanel
              workspaceId={workspaceId ?? ""}
              entityType="character"
              entityId={effectiveCharacter.characterId}
              characters={characters}
              locations={locations}
              onOpenUnit={handleOpenUnit}
            />
          ) : (
            <div className={styles.emptyPane}>
              尚无角色档案——让助理在对话中建档，或点右上「新建角色」。
            </div>
          );
        actions = (
          <Button
            variant="secondary"
            size="sm"
            leadingIcon={<Icon icon={Plus} size="xs" />}
            onClick={() => setCharacterDialogOpen(true)}
          >
            新建角色
          </Button>
        );
        break;
      }
      case "locations":
      default: {
        context =
          effectiveLocation !== undefined
            ? `${effectiveLocation.name} · ${effectiveLocation.locState}`
            : undefined;
        content =
          effectiveLocation !== undefined ? (
            <EntityInspectorPanel
              workspaceId={workspaceId ?? ""}
              entityType="location"
              entityId={effectiveLocation.locationId}
              characters={characters}
              locations={locations}
              onOpenUnit={handleOpenUnit}
            />
          ) : (
            <div className={styles.emptyPane}>
              尚无地点档案——让助理在对话中建档，或点右上「新建地点」。
            </div>
          );
        actions = (
          <Button
            variant="secondary"
            size="sm"
            leadingIcon={<Icon icon={Plus} size="xs" />}
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
          context={context}
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
        <MainSubHead
          title={PANE_META[value].title}
          sub={PANE_META[value].kicker}
          context={selectedChapter?.title}
          onBack={onBack}
          actions={
            selectedChapter !== undefined ? (
              <Button
                variant="ghost"
                size="sm"
                leadingIcon={<Icon icon={Copy} size="xs" />}
                onClick={() => void handleCopyChapter()}
              >
                复制正文
              </Button>
            ) : null
          }
        />
      ) : null}
      {renderTab(value)}
      <StoryUnitEditDialog
        open={unitDialogOpen}
        onOpenChange={setUnitDialogOpen}
        title={outline.selectedUnitId !== undefined ? "新建子单元" : "新建单元"}
        error={outline.error?.message}
        onSubmit={(input) =>
          outlineTree.createStoryUnit({
            ...(outline.selectedUnitId !== undefined
              ? { parentId: outline.selectedUnitId as never }
              : {}),
            ...input,
          })
        }
      />
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
