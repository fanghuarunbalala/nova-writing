/**
 * ContentDirectoryDetail
 *
 * 右栏下钻详情页（PRD F2-F4，demo v0.10 dirDetailPageHTML）：点击目录最细
 * 粒度行整栏展示——
 * - unit 大纲单元：状态 chips + 受阻/废弃横幅 + 意图/梗概 + 场景 leaf
 *   （复用 LeafPlanCard）+ 关联章段落列表；
 * - chapter 章：状态/meta + 关联场景 chip（面板内互跳）+ 全部段落；
 * - character/location 档案：简介/初始状态 + 关联单元 chips（互跳）+ 打开完整档案。
 * 左上「目录」返回；段落行（与目录行同）可拖入输入框作引用（PRD F5）；
 * 「查看单元详情 / 在正文中查看 / 打开完整档案」跳内容视图。
 * 数据全部复用 chat 视图已加载的域 store（零新增查询）。
 */
import { useMemo, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ListTree,
  MapPin,
  ScrollText,
  User,
  X,
  type LucideIcon,
} from "lucide-react";
import { Icon, StatusChip } from "../../../shared/primitives/index.js";
import { useExternalStore } from "../../../shared/state/useExternalStore.js";
import type { CharacterStore } from "../../../domains/novel/character/store/CharacterStore.js";
import { useCharacterDetail } from "../../../domains/novel/character/hooks/useCharacterDetail.js";
import type { LocationStore } from "../../../domains/novel/location/store/LocationStore.js";
import { useLocationDetail } from "../../../domains/novel/location/hooks/useLocationDetail.js";
import type { ManuscriptStructureStore } from "../../../domains/novel/manuscript/store/ManuscriptStructureStore.js";
import type { StoryOutlineTreeStore } from "../../../domains/novel/outline/store/StoryOutlineTreeStore.js";
import { LeafPlanCard } from "../../../domains/novel/outline/components/LeafPlanCard.js";
import {
  ABANDON_REASON_LABEL,
  BLOCK_REASON_LABEL,
  PLAN_STATUS,
  REAL_STATUS,
  formatSynopsisDisplay,
  realizationView,
  SCOPE_TYPE,
} from "../../../domains/novel/outline/outlineStatus.js";
import { setReferenceDragPayload } from "../../../domains/conversation/reference/referenceDnd.js";
import type { ContentDirectoryStore, DirectoryDetail } from "../ContentDirectoryStore.js";
import styles from "./ContentDirectoryDetail.module.css";

export interface DirectoryDetailContext {
  readonly detail: DirectoryDetail;
  readonly store: ContentDirectoryStore;
  readonly outlineTree: StoryOutlineTreeStore;
  readonly manuscript: ManuscriptStructureStore;
  readonly characters: CharacterStore;
  readonly locations: LocationStore;
  /** 「查看单元详情」→ 内容视图大纲单元详情 */
  readonly onSelectOutlineUnit: (unitId: string) => void;
  /** 「在正文中查看」/ 段落行点击 → 内容视图正文位 */
  readonly onOpenChapter: (chapterId: string) => void;
  /** 「打开完整档案」→ 内容视图人物档案 */
  readonly onOpenCharacter: (characterId: string) => void;
  /** 「打开完整档案」→ 内容视图地点档案 */
  readonly onOpenLocation: (locationId: string) => void;
}

const TITLE_ICON: Record<DirectoryDetail["kind"], LucideIcon> = {
  unit: ListTree,
  chapter: ScrollText,
  character: User,
  location: MapPin,
};

/** 详情页头：返回钮 + 类型图标/标题/kicker（locate 闪烁目标）。 */
export function DirectoryDetailHead(ctx: DirectoryDetailContext) {
  const { detail, store } = ctx;
  const head = useDetailHead(ctx);
  const icon = TITLE_ICON[detail.kind];
  return (
    <div className={styles.detailHead}>
      <button
        type="button"
        className={styles.back}
        onClick={() => store.back()}
        title="返回目录列表"
      >
        <Icon icon={ArrowLeft} size="xs" />
        目录
      </button>
      <div className={styles.titleRow} data-dir-detail-title>
        <Icon icon={icon} size="sm" />
        <b className={styles.title}>{head.title}</b>
        <span className={styles.kicker}>{head.kicker}</span>
      </div>
    </div>
  );
}

/** 详情页体：按 kind 分发（unit / chapter / character|location）。 */
export function DirectoryDetailBody(ctx: DirectoryDetailContext) {
  const { detail } = ctx;
  if (detail.kind === "unit") return <UnitDetailBody {...ctx} />;
  if (detail.kind === "chapter") return <ChapterDetailBody {...ctx} />;
  return <EntityDetailBody {...ctx} />;
}

interface DetailHeadInfo {
  readonly title: string;
  readonly kicker: string;
}

function useDetailHead(ctx: DirectoryDetailContext): DetailHeadInfo {
  const { detail, outlineTree, manuscript, characters, locations } = ctx;
  const outlineSnapshot = useExternalStore(outlineTree);
  const manuscriptSnapshot = useExternalStore(manuscript);
  const characterSnapshot = useExternalStore(characters);
  const locationSnapshot = useExternalStore(locations);
  return useMemo<DetailHeadInfo>(() => {
    if (detail.kind === "unit") {
      const unit = outlineTree.getUnit(detail.id);
      if (unit === undefined) return { title: "单元不存在", kicker: "大纲" };
      return { title: unit.title, kicker: `大纲 · ${SCOPE_TYPE[unit.scope ?? "custom"].label}` };
    }
    if (detail.kind === "chapter") {
      const chapter = manuscriptSnapshot.chapters.find((item) => item.chapterId === detail.id);
      if (chapter === undefined) return { title: "章节不存在", kicker: "正文" };
      const volume = manuscriptSnapshot.volumes.find((item) => item.volumeId === chapter.volumeId);
      return { title: chapter.title, kicker: `正文${volume !== undefined ? ` · ${volume.title}` : ""}` };
    }
    if (detail.kind === "character") {
      const summary = characterSnapshot.characters.find((item) => item.characterId === detail.id);
      return { title: summary?.name ?? "人物档案", kicker: `人物档案${summary?.role !== undefined && summary.role !== "" ? ` · ${summary.role}` : ""}` };
    }
    const summary = locationSnapshot.locations.find((item) => item.locationId === detail.id);
    return { title: summary?.name ?? "地点档案", kicker: "地点档案" };
  }, [detail, outlineSnapshot, manuscriptSnapshot, characterSnapshot, locationSnapshot, outlineTree]);
}

/* ============ F2 大纲单元详情（场景 = 完整 leaf + 段落） ============ */

function UnitDetailBody(ctx: DirectoryDetailContext) {
  const { detail, store, outlineTree, manuscript, characters, locations, onSelectOutlineUnit, onOpenChapter } = ctx;
  const outlineSnapshot = useExternalStore(outlineTree);
  const manuscriptSnapshot = useExternalStore(manuscript);
  const characterSnapshot = useExternalStore(characters);
  const locationSnapshot = useExternalStore(locations);
  const unit = outlineTree.getUnit(detail.id);
  // 段落以「挂靠单元」为准（unitParagraphs 含未入选章选择的段落——leaf 写入即可见）；
  // 章经 storyUnitId 反查仅作来源提示（P3 起章以 paragraphIds 选择为准，可能未设）
  const chapter = useMemo(
    () => manuscriptSnapshot.chapters.find((item) => item.storyUnitId === detail.id),
    [manuscriptSnapshot.chapters, detail.id],
  );
  const paragraphs = useMemo(
    () => manuscriptSnapshot.unitParagraphs.get(detail.id) ?? [],
    [manuscriptSnapshot.unitParagraphs, detail.id],
  );
  const characterNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of characterSnapshot.characters) map.set(item.characterId, item.name);
    return map;
  }, [characterSnapshot.characters]);
  const locationNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of locationSnapshot.locations) map.set(item.locationId, item.name);
    return map;
  }, [locationSnapshot.locations]);

  if (unit === undefined) {
    return <MissingDetail onBack={() => store.back()} label="该故事单元不存在（可能已被删除）" />;
  }
  const real = REAL_STATUS[realizationView(unit)];
  return (
    <div className={styles.body}>
      <div className={styles.statusChips}>
        <StatusChip variant={PLAN_STATUS[unit.planningStatus ?? "idea"].variant}>{PLAN_STATUS[unit.planningStatus ?? "idea"].label}</StatusChip>
        <StatusChip variant={real.variant}>{real.label}</StatusChip>
      </div>
      {unit.blockState !== undefined ? (
        <div className={styles.bannerWarn}>
          <Icon icon={AlertTriangle} size="xs" />
          <span>
            受阻 · {BLOCK_REASON_LABEL[unit.blockState.reasonCode ?? "dependency"] ?? unit.blockState.reasonCode}
            {unit.blockState.note !== undefined && unit.blockState.note !== "" ? `：${unit.blockState.note}` : ""}
          </span>
        </div>
      ) : null}
      {unit.abandonment !== undefined ? (
        <div className={styles.bannerFaint}>
          <Icon icon={X} size="xs" />
          <span>
            已废弃 · {ABANDON_REASON_LABEL[unit.abandonment.reasonCode ?? "merged"] ?? unit.abandonment.reasonCode}
            {unit.abandonment.note !== undefined && unit.abandonment.note !== "" ? `：${unit.abandonment.note}` : ""}
          </span>
        </div>
      ) : null}
      <DetailSec label="意图">{unit.intent ?? "（尚未填写——这个单元要达成什么）"}</DetailSec>
      <DetailSec label="梗概">
        {unit.synopsis !== undefined && unit.synopsis !== ""
          ? formatSynopsisDisplay(unit.synopsis)
          : "（尚未填写情节梗概）"}
      </DetailSec>
      {unit.scope === "scene" ? (
        <LeafPlanCard
          leaf={unit.leaf}
          characterNames={characterNames}
          locationNames={locationNames}
          onOpenCharacter={(characterId) => store.openDetail({ kind: "character", id: characterId })}
          onOpenLocation={(locationId) => store.openDetail({ kind: "location", id: locationId })}
        />
      ) : null}
      <div className={styles.sectionHead}>
        正文段落 · 挂靠本单元（{paragraphs.length}，含未入章，可拖入输入框）
      </div>
      <ParagraphRows
        items={paragraphs.map((paragraph) => ({
          id: paragraph.paragraphId,
          text: paragraph.text,
          unpublished: !manuscriptSnapshot.publishedParagraphIds.has(paragraph.paragraphId),
        }))}
        dragLabelFor={(index) =>
          paragraphDragLabel(chapter?.title ?? unit.title, index)
        }
        onOpen={chapter !== undefined ? () => onOpenChapter(chapter.chapterId) : undefined}
        emptyLabel="该单元尚未写入正文段落——拖入本单元或在对话里让 AI 起草。"
      />
      <div className={styles.actions}>
        <button type="button" className={styles.go} onClick={() => onSelectOutlineUnit(unit.id)}>
          查看单元详情（内容视图）
          <Icon icon={ArrowRight} size="xs" />
        </button>
        {chapter !== undefined ? (
          <button type="button" className={styles.go} onClick={() => onOpenChapter(chapter.chapterId)}>
            在正文中查看
            <Icon icon={ArrowRight} size="xs" />
          </button>
        ) : null}
      </div>
    </div>
  );
}

/* ============ F3 章详情（关联场景 + 全部段落） ============ */

function ChapterDetailBody(ctx: DirectoryDetailContext) {
  const { detail, store, outlineTree, manuscript, onOpenChapter } = ctx;
  const outlineSnapshot = useExternalStore(outlineTree);
  const manuscriptSnapshot = useExternalStore(manuscript);
  const chapter = manuscriptSnapshot.chapters.find((item) => item.chapterId === detail.id);
  if (chapter === undefined) {
    return <MissingDetail onBack={() => store.back()} label="该章节不存在（可能已被删除）" />;
  }
  const unit = chapter.storyUnitId !== undefined ? outlineTree.getUnit(chapter.storyUnitId) : undefined;
  const real = REAL_STATUS[unit !== undefined ? realizationView(unit) : "pending"];
  return (
    <div className={styles.body}>
      <div className={styles.statusChips}>
        <StatusChip variant={real.variant}>{real.label}</StatusChip>
        {chapter.isDraft ? <StatusChip variant="warn" compact>含草稿</StatusChip> : null}
      </div>
      {unit?.blockState !== undefined ? (
        <div className={styles.bannerWarn}>
          <Icon icon={AlertTriangle} size="xs" />
          <span>
            本章受阻 · {BLOCK_REASON_LABEL[unit.blockState.reasonCode ?? "dependency"] ?? unit.blockState.reasonCode}
            {unit.blockState.note !== undefined && unit.blockState.note !== "" ? `：${unit.blockState.note}` : ""}
          </span>
        </div>
      ) : null}
      {unit?.abandonment !== undefined ? (
        <div className={styles.bannerFaint}>
          <Icon icon={X} size="xs" />
          <span>
            已废弃 · {ABANDON_REASON_LABEL[unit.abandonment.reasonCode ?? "merged"] ?? unit.abandonment.reasonCode}
            {unit.abandonment.note !== undefined && unit.abandonment.note !== "" ? `：${unit.abandonment.note}` : ""}
          </span>
        </div>
      ) : null}
      <DetailSec label="关联场景">
        {unit !== undefined ? (
          <button
            type="button"
            className={styles.linkChip}
            onClick={() => store.openDetail({ kind: "unit", id: unit.id })}
            title="面板内打开场景详情"
          >
            <Icon icon={ListTree} size="xs" />
            {unit.title}
          </button>
        ) : (
          "（未关联——自由章）"
        )}
      </DetailSec>
      <div className={styles.sectionHead}>段落 · 已选入本章（可拖入输入框）</div>
      <ParagraphRows
        items={chapter.blocks.map((block) => ({ id: block.blockId, text: block.text }))}
        dragLabelFor={(index) => paragraphDragLabel(chapter.title, index)}
        onOpen={() => onOpenChapter(chapter.chapterId)}
        emptyLabel="此章尚未落笔——拖入关联场景或直接下指令，让 AI 起草。"
      />
      <div className={styles.actions}>
        <button type="button" className={styles.go} onClick={() => onOpenChapter(chapter.chapterId)}>
          在正文中查看（阅读区）
          <Icon icon={ArrowRight} size="xs" />
        </button>
      </div>
    </div>
  );
}

/* ============ F4 人物/地点档案页 ============ */

function EntityDetailBody(ctx: DirectoryDetailContext) {
  const { detail, store, outlineTree, characters, locations, onOpenCharacter, onOpenLocation } = ctx;
  const outlineSnapshot = useExternalStore(outlineTree);
  const characterSnapshot = useExternalStore(characters);
  const locationSnapshot = useExternalStore(locations);
  const isCharacter = detail.kind === "character";
  // 两 hook 均无条件调用（非目标侧传 undefined id = 只返回 undefined 不加载）
  const characterDetail = useCharacterDetail(characters, isCharacter ? detail.id : undefined);
  const locationDetail = useLocationDetail(locations, isCharacter ? undefined : detail.id);
  const entity = isCharacter ? characterDetail.detail : locationDetail.detail;
  const summary = isCharacter
    ? characterSnapshot.characters.find((item) => item.characterId === detail.id)
    : locationSnapshot.locations.find((item) => item.locationId === detail.id);
  const relatedUnits =
    outlineSnapshot.bindings[isCharacter ? "characters" : "locations"].get(detail.id) ?? [];
  const titleById = useMemo(() => {
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

  if (summary === undefined) {
    return <MissingDetail onBack={() => store.back()} label={isCharacter ? "该人物档案不存在" : "该地点档案不存在"} />;
  }
  return (
    <div className={styles.body}>
      <DetailSec label="简介">{entity?.summary ?? summary.note ?? "（尚未填写）"}</DetailSec>
      {isCharacter && entity?.initialState !== undefined && entity.initialState !== "" ? (
        <DetailSec label="初始状态">{entity.initialState}</DetailSec>
      ) : null}
      {relatedUnits.length > 0 ? (
        <DetailSec label="关联单元">
          <span className={styles.chips}>
            {relatedUnits.map((unitId) => {
              const title = titleById.get(unitId);
              return title === undefined ? null : (
                <button
                  key={unitId}
                  type="button"
                  className={styles.linkChip}
                  onClick={() => store.openDetail({ kind: "unit", id: unitId })}
                  title="面板内打开单元详情"
                >
                  <Icon icon={ListTree} size="xs" />
                  {title}
                </button>
              );
            })}
          </span>
        </DetailSec>
      ) : null}
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.go}
          onClick={() =>
            isCharacter ? onOpenCharacter(detail.id) : onOpenLocation(detail.id)
          }
        >
          打开完整档案（内容视图）
          <Icon icon={ArrowRight} size="xs" />
        </button>
      </div>
    </div>
  );
}

/* ============ 共用小件 ============ */

function DetailSec({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className={styles.sec}>
      <span className={styles.secLabel}>{label}</span>
      {children}
    </div>
  );
}

function MissingDetail({ onBack, label }: { readonly onBack: () => void; readonly label: string }) {
  return (
    <div className={styles.body}>
      <div className={styles.empty}>{label}</div>
      <div className={styles.actions}>
        <button type="button" className={styles.go} onClick={onBack}>
          返回目录列表
          <Icon icon={ArrowLeft} size="xs" />
        </button>
      </div>
    </div>
  );
}

/** 段落行条目（章 blocks / 单元挂靠段落 共用的轻量形状） */
interface ParagraphRowItem {
  readonly id: string;
  readonly text: string;
  readonly unpublished?: boolean;
}

/**
 * 段落行列表（章/场景详情共用）：P 序号 + 截断文本 + 未入章标记；
 * 可拖入输入框作引用；点击跳正文（无关联章时不可点）。
 */
function ParagraphRows({
  items,
  dragLabelFor,
  onOpen,
  emptyLabel,
}: {
  readonly items: readonly ParagraphRowItem[];
  /** 段序 → 引用 chip 短标签（章题前缀 + 段序） */
  readonly dragLabelFor: (index: number) => string;
  readonly onOpen: (() => void) | undefined;
  readonly emptyLabel: string;
}) {
  if (items.length === 0) {
    return <div className={styles.empty}>{emptyLabel}</div>;
  }
  return (
    <div>
      {items.map((item, index) => (
        <div
          key={item.id}
          className={styles.paraRow}
          draggable
          data-dir-paragraph={item.id}
          title={
            onOpen !== undefined
              ? "拖入输入框作引用 · 点击去正文阅读"
              : "拖入输入框作引用（本单元暂无关联章）"
          }
          onClick={onOpen}
          onDragStart={(event) =>
            setReferenceDragPayload(event, {
              kind: "paragraph",
              id: item.id,
              label: dragLabelFor(index),
            })
          }
        >
          <span className={styles.pIdx}>P{index + 1}</span>
          <span className={styles.pTxt}>{item.text}</span>
          {item.unpublished ? <StatusChip variant="warn" compact>未入章</StatusChip> : null}
        </div>
      ))}
    </div>
  );
}

/** 段落引用 chip 短标签：章题首个「 · 」前缀 + 段序（无分隔符则整题后置）。 */
function paragraphDragLabel(chapterTitle: string, index: number): string {
  const separator = chapterTitle.indexOf(" · ");
  const prefix = separator > 0 ? chapterTitle.slice(0, separator) : chapterTitle;
  return separator > 0 ? `${prefix} · 段 ${index + 1}` : `段 ${index + 1} · ${chapterTitle}`;
}
