/**
 * ContentDirectoryPanel
 *
 * 右栏内容目录（demo 方案 A v0.8）：对话视图常驻的三 tab——
 * 大纲（树复用，点击跳内容视图单元详情）/ 人物 / 地点（行点击就地展开
 * 详情卡：简介 / 初始状态 / 关联单元 chips +「打开完整档案」跳内容视图）。
 * 手风琴单开；实体标签点击经 ContentDirectoryStore.locate 切 tab + 滚动高亮。
 * 数据复用 chat 视图已加载的三个域 store（novelChangeBus 自动失效刷新）。
 */
import { useEffect, useMemo, useRef } from "react";
import { ArrowRight, ListTree, MapPin, User } from "lucide-react";
import { Icon } from "../../../shared/primitives/Icon.js";
import { useExternalStore } from "../../../shared/state/useExternalStore.js";
import type { CharacterStore } from "../../../domains/novel/character/store/CharacterStore.js";
import type { LocationStore } from "../../../domains/novel/location/store/LocationStore.js";
import type { StoryOutlineTreeStore } from "../../../domains/novel/outline/store/StoryOutlineTreeStore.js";
import { StoryOutlineTreeProjection } from "../../../domains/novel/outline/projection/StoryOutlineTreeProjection.js";
import { StoryOutlineTree } from "../../../domains/novel/outline/components/StoryOutlineTree.js";
import {
  ContentDirectoryStore,
  type ContentDirectoryTab,
  type DirectoryEntityKind,
} from "../ContentDirectoryStore.js";
import styles from "./ContentDirectoryPanel.module.css";

const TABS: readonly { readonly id: ContentDirectoryTab; readonly label: string; readonly icon: typeof ListTree }[] = [
  { id: "outline", label: "大纲", icon: ListTree },
  { id: "characters", label: "人物", icon: User },
  { id: "locations", label: "地点", icon: MapPin },
];

export interface ContentDirectoryPanelProps {
  readonly store: ContentDirectoryStore;
  readonly outlineTree: StoryOutlineTreeStore;
  readonly characters: CharacterStore;
  readonly locations: LocationStore;
  /** 大纲行点击 → 跳内容视图单元详情 */
  readonly onSelectOutlineUnit: (unitId: string) => void;
  /** 详情卡「打开完整档案」→ 跳内容视图人物档案 */
  readonly onOpenCharacter: (characterId: string) => void;
  /** 详情卡「打开完整档案」→ 跳内容视图地点档案 */
  readonly onOpenLocation: (locationId: string) => void;
}

export function ContentDirectoryPanel({
  store,
  outlineTree,
  characters,
  locations,
  onSelectOutlineUnit,
  onOpenCharacter,
  onOpenLocation,
}: ContentDirectoryPanelProps) {
  const dirSnapshot = useExternalStore(store);
  const outlineSnapshot = useExternalStore(outlineTree);
  const characterSnapshot = useExternalStore(characters);
  const locationSnapshot = useExternalStore(locations);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // 关联单元 chips：unitId → 标题（大纲树快照派生）
  const unitTitleById = useMemo(() => {
    const map = new Map<string, string>();
    const walk = (nodes: readonly { unitId: string; title: string; children: readonly unknown[] }[]): void => {
      for (const node of nodes) {
        map.set(node.unitId, node.title);
        walk(node.children as readonly { unitId: string; title: string; children: readonly unknown[] }[]);
      }
    };
    walk(outlineSnapshot.tree as never);
    return map;
  }, [outlineSnapshot.tree]);

  // 实体定位：切 tab 后滚动到目标行并闪烁（nonce 驱动，同一目标重复点击也生效）
  const locate = dirSnapshot.locate;
  const rowFlashClass = styles.rowFlash ?? "";
  useEffect(() => {
    if (locate === undefined || scrollRef.current === null || rowFlashClass === "") return;
    const row = scrollRef.current.querySelector<HTMLElement>(
      `[data-dir-key="${locate.kind}:${locate.id}"]`,
    );
    if (row === null) return;
    row.scrollIntoView({ block: "nearest", behavior: "smooth" });
    row.classList.remove(rowFlashClass);
    void row.offsetWidth;
    row.classList.add(rowFlashClass);
  }, [locate, rowFlashClass]);

  const workspaceId =
    outlineSnapshot.workspaceId ?? characterSnapshot.workspaceId ?? "";
  const outlineCount = useMemo(
    () => StoryOutlineTreeProjection.countAll(outlineSnapshot.tree),
    [outlineSnapshot.tree],
  );

  return (
    <div className={styles.panel}>
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
            ) : tab.id === "characters" && characterSnapshot.characters.length > 0 ? (
              <span className={styles.tabCount}>{characterSnapshot.characters.length}</span>
            ) : tab.id === "locations" && locationSnapshot.locations.length > 0 ? (
              <span className={styles.tabCount}>{locationSnapshot.locations.length}</span>
            ) : null}
          </button>
        ))}
      </div>
      <div className={styles.scroll} ref={scrollRef}>
        {dirSnapshot.tab === "outline" ? (
          <StoryOutlineTree
            workspaceId={workspaceId}
            tree={outlineSnapshot.tree}
            phase={outlineSnapshot.phase}
            expansionState={outlineSnapshot.expansionState}
            selectedUnitId={outlineSnapshot.selectedUnitId}
            onSelectUnit={onSelectOutlineUnit}
            onToggleExpand={(id) => outlineTree.toggleExpand(id)}
            showLegend={false}
          />
        ) : dirSnapshot.tab === "characters" ? (
          characterSnapshot.characters.length === 0 ? (
            <div className={styles.empty}>尚无角色档案——对话里让助理建档后出现在这里</div>
          ) : (
            characterSnapshot.characters.map((c) => (
              <EntityRowWithDetail
                key={c.characterId}
                kind="character"
                id={c.characterId}
                avatarText={c.avatarText}
                title={c.name}
                subtitle={c.role}
                expanded={dirSnapshot.expandedKey === `character:${c.characterId}`}
                summaryNote={c.note}
                relatedUnits={c.relatedUnits}
                unitTitleById={unitTitleById}
                onToggle={() => store.toggleExpand(`character:${c.characterId}`)}
                onOpen={() => onOpenCharacter(c.characterId)}
                loadDetail={() => void characters.loadDetail(c.characterId)}
                detail={characterSnapshot.detailCache.get(c.characterId)}
              />
            ))
          )
        ) : locationSnapshot.locations.length === 0 ? (
          <div className={styles.empty}>尚无地点档案</div>
        ) : (
          locationSnapshot.locations.map((l) => (
            <EntityRowWithDetail
              key={l.locationId}
              kind="location"
              id={l.locationId}
              avatarText={l.avatarText}
              title={l.name}
              subtitle={l.locState}
              expanded={dirSnapshot.expandedKey === `location:${l.locationId}`}
              summaryNote={l.note}
              relatedUnits={l.relatedUnits}
              unitTitleById={unitTitleById}
              onToggle={() => store.toggleExpand(`location:${l.locationId}`)}
              onOpen={() => onOpenLocation(l.locationId)}
              loadDetail={() => void locations.loadDetail(l.locationId)}
              detail={locationSnapshot.detailCache.get(l.locationId)}
            />
          ))
        )}
        <div className={styles.foot}>
          对话流中的 <code>&lt;character_某某&gt;</code> 等实体标签可点击：本栏切到对应页签并高亮定位；面板左缘可拖拽调宽（双击复位）。
        </div>
      </div>
    </div>
  );
}

/** 人物/地点共用的详情数据形状（CharacterDetail / LocationDetail 同构子集） */
interface EntityDetailLike {
  readonly summary: string;
  readonly initialState: string;
}

/** 目录行 + 手风琴详情卡（展开时懒加载 detail；未缓存先用 note 摘要占位） */
function EntityRowWithDetail(props: {
  readonly kind: DirectoryEntityKind;
  readonly id: string;
  readonly avatarText: string;
  readonly title: string;
  readonly subtitle: string;
  readonly expanded: boolean;
  readonly summaryNote: string;
  readonly relatedUnits: readonly string[];
  readonly unitTitleById: ReadonlyMap<string, string>;
  readonly onToggle: () => void;
  readonly onOpen: () => void;
  readonly loadDetail: () => void;
  readonly detail: EntityDetailLike | undefined;
}) {
  const { expanded, loadDetail, detail } = props;
  useEffect(() => {
    if (expanded && detail === undefined) loadDetail();
  }, [expanded, detail, loadDetail]);

  return (
    <div className={styles.entityBlock}>
      <button
        type="button"
        className={[styles.row, expanded ? styles.rowOpen : ""].filter(Boolean).join(" ")}
        data-dir-key={`${props.kind}:${props.id}`}
        data-active={expanded || undefined}
        aria-expanded={expanded}
        onClick={props.onToggle}
      >
        <span className={styles.avatar} aria-hidden="true">
          {props.avatarText}
        </span>
        <span className={styles.rowText}>
          <span className={styles.rowTitle}>{props.title}</span>
          <span className={styles.rowSubtitle}>{props.subtitle}</span>
        </span>
        <span className={[styles.rowChev, expanded ? styles.rowChevOpen : ""].join(" ")}>
          <Icon icon={ArrowRight} size="xs" />
        </span>
      </button>
      {expanded ? (
        <div className={styles.detailCard}>
          <div className={styles.ddSec}>
            <span className={styles.ddLabel}>简介</span>
            {detail?.summary ?? props.summaryNote}
          </div>
          {props.kind === "character" && detail?.initialState ? (
            <div className={styles.ddSec}>
              <span className={styles.ddLabel}>初始状态</span>
              {detail.initialState}
            </div>
          ) : null}
          {props.relatedUnits.length > 0 ? (
            <div className={styles.ddSec}>
              <span className={styles.ddLabel}>关联单元</span>
              <span className={styles.ddChips}>
                {props.relatedUnits.map((unitId) => {
                  const title = props.unitTitleById.get(unitId);
                  return title === undefined ? null : (
                    <span key={unitId} className={styles.ddChip}>
                      {title}
                    </span>
                  );
                })}
              </span>
            </div>
          ) : null}
          <button type="button" className={styles.ddGo} onClick={props.onOpen}>
            打开完整档案
            <Icon icon={ArrowRight} size="xs" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
