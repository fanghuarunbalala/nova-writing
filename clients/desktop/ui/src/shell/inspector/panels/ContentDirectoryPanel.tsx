/**
 * ContentDirectoryPanel
 *
 * 右栏内容目录（PRD conversation-目录下钻与实体引用，demo v0.10）：列表 ⇄
 * 下钻详情页两态——
 * 列表态四 tab：大纲（父级行点击=展开/收起子层级；场景叶行点击=进单元详情）/
 * 正文（章行点击=进章详情）/ 人物 / 地点（行点击=进档案页）；所有目录行可
 * 拖入输入框作引用（HTML5 DnD 自定义 MIME，PRD F5）。
 * 详情态（store.detail）：DirectoryDetailHead（返回 + 标题，locate 闪烁目标）
 * + DirectoryDetailBody（场景完整 leaf + 段落 / 章·段落 / 档案，段落行可拖）。
 * locate(detail) 五类直达详情页（paragraph → 章详情 + 段落行闪烁）。
 * 数据复用 chat 视图已加载的域 store（novelChangeBus 自动失效刷新）。
 */
import { useEffect, useMemo, useRef } from "react";
import { ArrowRight, ListTree, MapPin, ScrollText, User } from "lucide-react";
import { Icon } from "../../../shared/primitives/Icon.js";
import { useExternalStore } from "../../../shared/state/useExternalStore.js";
import type { CharacterStore } from "../../../domains/novel/character/store/CharacterStore.js";
import type { LocationStore } from "../../../domains/novel/location/store/LocationStore.js";
import type { ManuscriptStructureStore } from "../../../domains/novel/manuscript/store/ManuscriptStructureStore.js";
import type { StoryOutlineTreeStore } from "../../../domains/novel/outline/store/StoryOutlineTreeStore.js";
import { StoryOutlineTreeProjection } from "../../../domains/novel/outline/projection/StoryOutlineTreeProjection.js";
import type { StoryOutlineTreeNode } from "../../../domains/novel/outline/projection/StoryOutlineTreeProjection.js";
import { StoryOutlineTree } from "../../../domains/novel/outline/components/StoryOutlineTree.js";
import { ManuscriptDirectory } from "../../sidebar/sections/ManuscriptDirectory.js";
import { setReferenceDragPayload } from "../../../domains/conversation/reference/referenceDnd.js";
import {
  ContentDirectoryStore,
  type ContentDirectoryTab,
} from "../ContentDirectoryStore.js";
import {
  DirectoryDetailBody,
  DirectoryDetailHead,
  type DirectoryDetailContext,
} from "./ContentDirectoryDetail.js";
import styles from "./ContentDirectoryPanel.module.css";

const TABS: readonly { readonly id: ContentDirectoryTab; readonly label: string; readonly icon: typeof ListTree }[] = [
  { id: "outline", label: "大纲", icon: ListTree },
  { id: "manuscript", label: "正文", icon: ScrollText },
  { id: "characters", label: "人物", icon: User },
  { id: "locations", label: "地点", icon: MapPin },
];

export interface ContentDirectoryPanelProps {
  readonly store: ContentDirectoryStore;
  readonly outlineTree: StoryOutlineTreeStore;
  readonly manuscript: ManuscriptStructureStore;
  readonly characters: CharacterStore;
  readonly locations: LocationStore;
  /** 单元详情页「查看单元详情」→ 跳内容视图单元详情 */
  readonly onSelectOutlineUnit: (unitId: string) => void;
  /** 章详情页「在正文中查看」/ 段落行点击 → 跳内容视图正文位 */
  readonly onOpenChapter: (chapterId: string) => void;
  /** 档案页「打开完整档案」→ 跳内容视图人物档案 */
  readonly onOpenCharacter: (characterId: string) => void;
  /** 档案页「打开完整档案」→ 跳内容视图地点档案 */
  readonly onOpenLocation: (locationId: string) => void;
}

function findTreeNode(
  nodes: readonly StoryOutlineTreeNode[],
  unitId: string,
): StoryOutlineTreeNode | undefined {
  for (const node of nodes) {
    if (node.unitId === unitId) return node;
    const hit = findTreeNode(node.children, unitId);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

export function ContentDirectoryPanel({
  store,
  outlineTree,
  manuscript,
  characters,
  locations,
  onSelectOutlineUnit,
  onOpenChapter,
  onOpenCharacter,
  onOpenLocation,
}: ContentDirectoryPanelProps) {
  const dirSnapshot = useExternalStore(store);
  const outlineSnapshot = useExternalStore(outlineTree);
  const manuscriptSnapshot = useExternalStore(manuscript);
  const characterSnapshot = useExternalStore(characters);
  const locationSnapshot = useExternalStore(locations);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // storyUnitId → 实现态（正文 tab 章行状态圆点派生用，同 Sidebar 口径）
  const realizationByUnit = useMemo(() => {
    const map = new Map<string, string>();
    const walk = (nodes: readonly StoryOutlineTreeNode[]): void => {
      for (const node of nodes) {
        map.set(node.unitId, node.realization);
        walk(node.children);
      }
    };
    walk(outlineSnapshot.tree);
    return map;
  }, [outlineSnapshot.tree]);

  // 定位闪烁（nonce 驱动重复生效）：paragraph → 章详情页段落行；其余 → 详情标题行
  const locate = dirSnapshot.locate;
  const rowFlashClass = styles.rowFlash ?? "";
  useEffect(() => {
    if (locate === undefined || rootRef.current === null || rowFlashClass === "") return;
    const target =
      locate.detail.paragraphId !== undefined
        ? rootRef.current.querySelector<HTMLElement>(
            `[data-dir-paragraph="${locate.detail.paragraphId}"]`,
          )
        : rootRef.current.querySelector<HTMLElement>("[data-dir-detail-title]");
    if (target === null) return;
    target.scrollIntoView({ block: "nearest", behavior: "smooth" });
    target.classList.remove(rowFlashClass);
    void target.offsetWidth;
    target.classList.add(rowFlashClass);
  }, [locate, rowFlashClass]);

  const workspaceId =
    outlineSnapshot.workspaceId ?? characterSnapshot.workspaceId ?? "";
  const outlineCount = useMemo(
    () => StoryOutlineTreeProjection.countAll(outlineSnapshot.tree),
    [outlineSnapshot.tree],
  );

  const detail = dirSnapshot.detail;
  const detailCtx: DirectoryDetailContext | undefined =
    detail !== undefined
      ? {
          detail,
          store,
          outlineTree,
          manuscript,
          characters,
          locations,
          onSelectOutlineUnit,
          onOpenChapter,
          onOpenCharacter,
          onOpenLocation,
        }
      : undefined;

  return (
    <div className={styles.panel} ref={rootRef}>
      {detailCtx !== undefined ? (
        <DirectoryDetailHead {...detailCtx} />
      ) : (
        <div className={styles.tabs} role="tablist" aria-label="内容目录">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={dirSnapshot.tab === tab.id}
              className={[styles.tab, dirSnapshot.tab === tab.id ? styles.tabActive : ""]
                .filter(Boolean)
                .join(" ")}
              onClick={() => store.setTab(tab.id)}
            >
              <Icon icon={tab.icon} size="sm" />
              <span>{tab.label}</span>
              {tab.id === "outline" && outlineCount > 0 ? (
                <span className={styles.tabCount}>{outlineCount}</span>
              ) : tab.id === "manuscript" && manuscriptSnapshot.chapters.length > 0 ? (
                <span className={styles.tabCount}>{manuscriptSnapshot.chapters.length}</span>
              ) : tab.id === "characters" && characterSnapshot.characters.length > 0 ? (
                <span className={styles.tabCount}>{characterSnapshot.characters.length}</span>
              ) : tab.id === "locations" && locationSnapshot.locations.length > 0 ? (
                <span className={styles.tabCount}>{locationSnapshot.locations.length}</span>
              ) : null}
            </button>
          ))}
        </div>
      )}
      <div className={styles.scroll}>
        {detailCtx !== undefined ? (
          <DirectoryDetailBody {...detailCtx} />
        ) : dirSnapshot.tab === "outline" ? (
          <StoryOutlineTree
            workspaceId={workspaceId}
            tree={outlineSnapshot.tree}
            phase={outlineSnapshot.phase}
            expansionState={outlineSnapshot.expansionState}
            selectedUnitId={outlineSnapshot.selectedUnitId}
            onSelectUnit={(unitId) => {
              // 叶（场景）行点击 = 进单元详情页；父级行点击 = 展开/收起子层级；
              // 跳内容视图只走详情页内「查看单元详情」。
              const node = findTreeNode(outlineSnapshot.tree, unitId);
              if (node !== undefined && node.children.length === 0) {
                store.openDetail({ kind: "unit", id: unitId });
              } else {
                outlineTree.toggleExpand(unitId);
              }
            }}
            onToggleExpand={(id) => outlineTree.toggleExpand(id)}
            showLegend={false}
            draggableUnits={() => true}
            onUnitDragStart={(unitId, event) => {
              const node = findTreeNode(outlineSnapshot.tree, unitId);
              if (node === undefined) return;
              setReferenceDragPayload(event, { kind: "outline", id: unitId, label: node.title });
            }}
          />
        ) : dirSnapshot.tab === "manuscript" ? (
          <ManuscriptDirectory
            snapshot={manuscriptSnapshot}
            onSelectChapter={(chapterId) => store.openDetail({ kind: "chapter", id: chapterId })}
            resolveChapterState={(chapterId) => {
              const chapter = manuscriptSnapshot.chapters.find(
                (item) => item.chapterId === chapterId,
              );
              return chapter?.storyUnitId !== undefined
                ? realizationByUnit.get(chapter.storyUnitId)
                : undefined;
            }}
            draggableChapters={() => true}
            onChapterDragStart={(chapterId, event) => {
              const chapter = manuscriptSnapshot.chapters.find(
                (item) => item.chapterId === chapterId,
              );
              if (chapter === undefined) return;
              setReferenceDragPayload(event, { kind: "chapter", id: chapterId, label: chapter.title });
            }}
          />
        ) : dirSnapshot.tab === "characters" ? (
          characterSnapshot.characters.length === 0 ? (
            <div className={styles.empty}>尚无角色档案——对话里让助理建档后出现在这里</div>
          ) : (
            characterSnapshot.characters.map((c) => (
              <EntityDirectoryRow
                key={c.characterId}
                kind="character"
                id={c.characterId}
                avatarText={c.avatarText}
                title={c.name}
                subtitle={c.role}
                onOpen={() => store.openDetail({ kind: "character", id: c.characterId })}
              />
            ))
          )
        ) : locationSnapshot.locations.length === 0 ? (
          <div className={styles.empty}>尚无地点档案</div>
        ) : (
          locationSnapshot.locations.map((l) => (
            <EntityDirectoryRow
              key={l.locationId}
              kind="location"
              id={l.locationId}
              avatarText={l.avatarText}
              title={l.name}
              subtitle={l.locState}
              onOpen={() => store.openDetail({ kind: "location", id: l.locationId })}
            />
          ))
        )}
        {detailCtx === undefined ? (
          <div className={styles.foot}>
            点击行进入详情（场景完整 leaf 与段落、章·段落、人物/地点档案），左上「目录」返回；行与段落均可拖入下方输入框作引用，随消息发送。面板左缘可拖拽调宽（双击复位）。
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** 人物/地点目录行（点击=进档案详情页；可拖入输入框作引用） */
function EntityDirectoryRow(props: {
  readonly kind: "character" | "location";
  readonly id: string;
  readonly avatarText: string;
  readonly title: string;
  readonly subtitle: string;
  readonly onOpen: () => void;
}) {
  return (
    <div className={styles.entityBlock}>
      <button
        type="button"
        className={styles.row}
        draggable
        title={`${props.title} · 点击看档案 · 可拖入输入框引用`}
        onClick={props.onOpen}
        onDragStart={(event) =>
          setReferenceDragPayload(event, { kind: props.kind, id: props.id, label: props.title })
        }
      >
        <span className={styles.avatar} aria-hidden="true">
          {props.avatarText}
        </span>
        <span className={styles.rowText}>
          <span className={styles.rowTitle}>{props.title}</span>
          <span className={styles.rowSubtitle}>{props.subtitle}</span>
        </span>
        <span className={styles.rowChev}>
          <Icon icon={ArrowRight} size="xs" />
        </span>
      </button>
    </div>
  );
}
