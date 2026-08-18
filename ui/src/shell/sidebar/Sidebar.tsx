/**
 * Sidebar
 *
 * 左侧栏 · 上下文目录（PRD SB-1~10）：内容随主视图切换——
 *   chat    = 新建对话 + 会话目录；
 *   content = 资料位四段 tab（大纲/正文/人物/地点）+ dirHead 标题行 + 对应目录
 *             （大纲树 / 卷章目录 / 人物档案 / 地点档案）；
 *   plan    = 「安排」待办目录（总览 + 按标签分组）；
 *   library = 书库书单目录（书行 + 状态 chip + 导入入口）。
 * 宽度固定档位随断点（决议 2：移除拖拽调宽），显隐由 mode 控制（负 margin 收起）。
 */
import { memo, useMemo, type ReactNode } from "react";
import { ChevronsDownUp, ChevronsUpDown, MapPin } from "lucide-react";
import type { ConversationCatalogStore } from "../../domains/conversation/store/ConversationCatalogStore.js";
import type { StoryOutlineTreeStore } from "../../domains/novel/outline/store/StoryOutlineTreeStore.js";
import type { StoryOutlineTreeNode } from "../../domains/novel/outline/projection/StoryOutlineTreeProjection.js";
import { StoryOutlineTreeProjection } from "../../domains/novel/outline/projection/StoryOutlineTreeProjection.js";
import type { ManuscriptStructureStore } from "../../domains/novel/manuscript/store/ManuscriptStructureStore.js";
import type { CharacterStore } from "../../domains/novel/character/store/CharacterStore.js";
import type { LocationStore } from "../../domains/novel/location/store/LocationStore.js";
import type { ScheduleStore } from "../../domains/schedule/store/ScheduleStore.js";
import type { ScheduleTodoStore } from "../../domains/schedule/store/ScheduleTodoStore.js";
import type { ApprovalStore } from "../../domains/approval/ApprovalStore.js";
import type { LibraryStore } from "../../domains/library/store/LibraryStore.js";
import type { ToastStore } from "../../shared/state/ToastStore.js";
import type { MainViewState } from "../../shared/routing/MainViewRouter.js";
import { useExternalStore } from "../../shared/state/useExternalStore.js";
import { Icon, IconButton } from "../../shared/primitives/index.js";
import { StoryOutlineTree } from "../../domains/novel/outline/components/StoryOutlineTree.js";
import type { ContentTab } from "../main/contentTab.js";
import { ContentTabs } from "./sections/ContentTabs.js";
import { DirectoryHead } from "./sections/DirectoryHead.js";
import { EntityDirectory } from "./sections/EntityDirectory.js";
import { ManuscriptDirectory } from "./sections/ManuscriptDirectory.js";
import { PlanDirectory } from "./sections/PlanDirectory.js";
import { LibraryDirectory } from "./sections/LibraryDirectory.js";
import { ConversationListSection } from "./sections/ConversationListSection.js";
import { NewConversationSection } from "./sections/NewConversationSection.js";
import styles from "./Sidebar.module.css";

export interface SidebarProps {
  readonly mode: "expanded" | "collapsed";
  /** 当前主视图（决定侧栏目录形态） */
  readonly view: MainViewState;
  readonly conversationCatalog: ConversationCatalogStore;
  readonly outlineTree: StoryOutlineTreeStore;
  readonly manuscript: ManuscriptStructureStore;
  readonly characters: CharacterStore;
  readonly locations: LocationStore;
  readonly schedule: ScheduleStore;
  readonly scheduleTodo: ScheduleTodoStore;
  readonly approvalStore: ApprovalStore;
  readonly library: LibraryStore;
  readonly toastStore: ToastStore;
  readonly workspaceId?: string;
  readonly onCreateConversation: () => void;
  /** 选择会话：catalog.selectConversation + 切回对话视图（宿主组合）。 */
  readonly onSelectConversation: (id: string) => void;
  /* --- 内容视图 --- */
  readonly contentTab: ContentTab;
  readonly onSelectContentPane: (pane: ContentTab) => void;
  readonly onSelectOutlineUnit: (unitId: string) => void;
  readonly onSelectChapter: (chapterId: string) => void;
  readonly selectedCharacterId?: string;
  readonly selectedLocationId?: string;
  readonly onSelectCharacter: (characterId: string) => void;
  readonly onSelectLocation: (locationId: string) => void;
  /* --- 计划视图 --- */
  readonly planTodoId: string | null;
  readonly onSelectPlanTodo: (id: string | null) => void;
}

/** storyUnitId → 实现态（章行状态圆点派生用） */
function collectRealization(
  nodes: readonly StoryOutlineTreeNode[],
  into: Map<string, string>,
): void {
  for (const node of nodes) {
    into.set(node.unitId, node.realization);
    collectRealization(node.children, into);
  }
}

/** 左侧栏 · 上下文目录（memo：流式发布期间跳过，gui-performance-2 功能点五） */
export const Sidebar = memo(function Sidebar({
  mode,
  view,
  conversationCatalog,
  outlineTree,
  manuscript,
  characters,
  locations,
  schedule,
  scheduleTodo,
  approvalStore,
  library,
  toastStore,
  workspaceId,
  onCreateConversation,
  onSelectConversation,
  contentTab,
  onSelectContentPane,
  onSelectOutlineUnit,
  onSelectChapter,
  selectedCharacterId,
  selectedLocationId,
  onSelectCharacter,
  onSelectLocation,
  planTodoId,
  onSelectPlanTodo,
}: SidebarProps) {
  const catalogSnapshot = conversationCatalog.getSnapshot();
  const outlineSnapshot = useExternalStore(outlineTree);
  const manuscriptSnapshot = useExternalStore(manuscript);
  const characterSnapshot = useExternalStore(characters);
  const locationSnapshot = useExternalStore(locations);
  const realizationByUnit = useMemo(() => {
    const map = new Map<string, string>();
    collectRealization(outlineSnapshot.tree, map);
    return map;
  }, [outlineSnapshot.tree]);

  let content: ReactNode = null;
  if (view === "chat") {
    // demo 侧栏无「对话」分组头：按钮 → 搜索框 → 时间分组（置顶/今天/更早）直达
    content = (
      <>
        <NewConversationSection
          onCreate={onCreateConversation}
          disabled={catalogSnapshot.workspaceId === undefined}
        />
        <ConversationListSection
          store={conversationCatalog}
          toastStore={toastStore}
          onSelect={onSelectConversation}
        />
      </>
    );
  } else if (view === "content") {
    const outlineTools =
      outlineSnapshot.tree.length > 0 ? (
        <>
          <IconButton
            label="展开全部"
            size="sm"
            onClick={() => outlineTree.expandAll()}
          >
            <Icon icon={ChevronsUpDown} size="xs" />
          </IconButton>
          <IconButton
            label="折叠全部"
            size="sm"
            onClick={() => outlineTree.collapseAll()}
          >
            <Icon icon={ChevronsDownUp} size="xs" />
          </IconButton>
        </>
      ) : null;
    const dirHead =
      contentTab === "outline" ? (
        <DirectoryHead
          label="故事单元"
          count={StoryOutlineTreeProjection.countAll(outlineSnapshot.tree)}
          tools={outlineTools}
        />
      ) : contentTab === "manuscript" ? (
        <DirectoryHead label="卷 · 章" count={manuscriptSnapshot.chapters.length} />
      ) : contentTab === "characters" ? (
        <DirectoryHead label="角色档案" count={characterSnapshot.characters.length} />
      ) : (
        <DirectoryHead label="地点档案" count={locationSnapshot.locations.length} />
      );
    content = (
      <>
        <ContentTabs active={contentTab} onSelect={onSelectContentPane} />
        {dirHead}
        {contentTab === "outline" ? (
          <StoryOutlineTree
            workspaceId={workspaceId ?? ""}
            tree={outlineSnapshot.tree}
            phase={outlineSnapshot.phase}
            expansionState={outlineSnapshot.expansionState}
            selectedUnitId={outlineSnapshot.selectedUnitId}
            onSelectUnit={onSelectOutlineUnit}
            onToggleExpand={(id) => outlineTree.toggleExpand(id)}
          />
        ) : contentTab === "manuscript" ? (
          <ManuscriptDirectory
            snapshot={manuscriptSnapshot}
            onSelectChapter={onSelectChapter}
            resolveChapterState={(chapterId) => {
              const chapter = manuscriptSnapshot.chapters.find(
                (item) => item.chapterId === chapterId,
              );
              return chapter?.storyUnitId !== undefined
                ? realizationByUnit.get(chapter.storyUnitId)
                : undefined;
            }}
          />
        ) : contentTab === "characters" ? (
          <EntityDirectory
            items={characterSnapshot.characters.map((c) => ({
              id: c.characterId,
              avatarText: c.avatarText,
              title: c.name,
              subtitle: c.role,
            }))}
            activeId={selectedCharacterId}
            onSelect={onSelectCharacter}
            emptyLabel="尚无角色档案——从对话里让助理建档，或在主区新建"
          />
        ) : (
          <EntityDirectory
            items={locationSnapshot.locations.map((l) => ({
              id: l.locationId,
              avatarText: l.avatarText,
              title: l.name,
              subtitle: l.locState,
              icon: MapPin,
            }))}
            activeId={selectedLocationId}
            onSelect={onSelectLocation}
            emptyLabel="尚无地点档案"
          />
        )}
      </>
    );
  } else if (view === "schedule") {
    content = (
      <PlanDirectory
        schedule={schedule}
        scheduleTodo={scheduleTodo}
        approvalStore={approvalStore}
        selectedTodoId={planTodoId}
        onSelect={onSelectPlanTodo}
      />
    );
  } else {
    content = <LibraryDirectory store={library} />;
  }

  return (
    <aside
      className={styles.sidebar}
      data-mode={mode}
      role="navigation"
      aria-label="侧栏"
    >
      {content}
    </aside>
  );
});
