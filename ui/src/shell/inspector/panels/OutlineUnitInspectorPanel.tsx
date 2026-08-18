/**
 * OutlineUnitInspectorPanel
 *
 * 大纲单元详情：对齐 core StoryUnit 契约与 app-redesign demo unitDetailHTML——
 * scope chip + 标题 / 元信息行（id·scope·orderKey·v·父） / 双状态 chip + 叶完成度
 * miniBar / blockState·abandonment banner / intent·synopsis / 跳转按钮 /
 * 场景计划 leaf 卡 / 关联卡（依赖·人物·子单元·发布章）。
 * 写路径（编辑 / 新建子单元 / 删除，乐观锁 baseRevision = entityVersion）保留。
 */
import { useState } from "react";
import {
  AlertTriangle,
  ListPlus,
  ListTree,
  MessageSquare,
  Pencil,
  ScrollText,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import type { StoryOutlineTreeNode } from "../../../domains/novel/outline/projection/StoryOutlineTreeProjection.js";
import type { StoryOutlineTreeStore } from "../../../domains/novel/outline/store/StoryOutlineTreeStore.js";
import {
  ABANDON_REASON_LABEL,
  BLOCK_REASON_LABEL,
  LEAF_PRESENCE_LABEL,
  LEAF_ROLE_LABEL,
  PLAN_STATUS,
  REAL_STATUS,
  scopeView,
} from "../../../domains/novel/outline/outlineStatus.js";
import {
  LeafEntityLookup,
  LeafPlanCard,
  RefChip,
} from "../../../domains/novel/outline/components/LeafPlanCard.js";
import { StoryUnitEditDialog } from "../../../domains/novel/outline/components/StoryUnitEditDialog.js";
import { useExternalStore } from "../../../shared/state/useExternalStore.js";
import { Button, ConfirmDialog, Icon, StatusChip } from "../../../shared/primitives/index.js";
import styles from "./OutlineUnitInspectorPanel.module.css";

/** 大纲单元详情展示的段落条目（来自 manuscript 域全量段落分组） */
export interface OutlinePanelUnitParagraph {
  readonly paragraphId: string;
  readonly orderKey?: string;
  readonly text: string;
  readonly textLength: number;
  readonly entityVersion: number;
}

export interface OutlineUnitInspectorPanelProps {
  readonly workspaceId: string | undefined;
  readonly unitId: string;
  readonly outlineTree: StoryOutlineTreeStore;
  /** 发布章候选（chapter.storyUnitId 反查；正文视图传入） */
  readonly chapters?: readonly { readonly chapterId: string; readonly title: string; readonly storyUnitId?: string }[];
  /** 本单元挂靠的全部段落（含未入选章选择的——agent 写入后在此立即可见） */
  readonly unitParagraphs?: readonly OutlinePanelUnitParagraph[];
  /** 已被任一章选择收录的段落 id（区分「已入选章 / 未发布」） */
  readonly publishedParagraphIds?: ReadonlySet<string>;
  readonly characterNames?: ReadonlyMap<string, LeafEntityLookup>;
  readonly locationNames?: ReadonlyMap<string, LeafEntityLookup>;
  /** 「在正文中查看」/ 发布章 chip：选章并切到正文资料位 */
  readonly onOpenChapter?: (chapterId: string) => void;
  /** 「在对话中讨论」：切回对话视图 */
  readonly onDiscuss?: () => void;
  /** leaf 人物 chip → 人物档案 */
  readonly onOpenCharacter?: (characterId: string) => void;
  /** leaf 地点 chip → 地点档案 */
  readonly onOpenLocation?: (locationId: string) => void;
}

function findNode(
  tree: readonly StoryOutlineTreeNode[],
  unitId: string,
): StoryOutlineTreeNode | undefined {
  for (const node of tree) {
    if (node.unitId === unitId) return node;
    const child = findNode(node.children, unitId);
    if (child !== undefined) return child;
  }
  return undefined;
}

/** 单元段落卡：列出挂靠本单元的全部段落（含未入选章选择的），agent 写入后在此可见 */
function UnitParagraphsCard({
  unitParagraphs,
  publishedParagraphIds,
}: {
  unitParagraphs: readonly OutlinePanelUnitParagraph[];
  publishedParagraphIds: ReadonlySet<string> | undefined;
}) {
  return (
    <div className={styles.card}>
      <h3 className={styles.cardTitle}>单元段落 · {unitParagraphs.length}</h3>
      {unitParagraphs.length === 0 ? (
        <span className={styles.noRelations}>
          暂无段落——可在对话中让 AI 写入本单元，段落会先出现在这里，再经章选择进入正文。
        </span>
      ) : (
        <div className={styles.leafSeq}>
          {unitParagraphs.map((p, index) => {
            const published = publishedParagraphIds?.has(p.paragraphId) ?? false;
            const text = p.text.trim();
            return (
              <span key={p.paragraphId} title={`${p.paragraphId} · ${p.textLength} 字`}>
                <i>
                  {String(index + 1).padStart(2, "0")}
                  <em className={styles.refTag}>{published ? "已入选章" : "未发布"}</em>
                </i>
                {text.length > 0 ? (text.length > 80 ? `${text.slice(0, 80)}…` : text) : "（空段落——待编写）"}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function OutlineUnitInspectorPanel({
  workspaceId,
  unitId,
  outlineTree,
  chapters,
  unitParagraphs,
  publishedParagraphIds,
  characterNames,
  locationNames,
  onOpenChapter,
  onDiscuss,
  onOpenCharacter,
  onOpenLocation,
}: OutlineUnitInspectorPanelProps) {
  const snapshot = useExternalStore(outlineTree);
  const unit = findNode(snapshot.tree, unitId);
  const coreUnit = outlineTree.getUnit(unitId);
  const [editOpen, setEditOpen] = useState(false);
  const [childOpen, setChildOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  if (unit === undefined) {
    return <div className={styles.panel}>未找到大纲单元</div>;
  }
  const plan = PLAN_STATUS[unit.planningStatus];
  const real = REAL_STATUS[unit.realization];
  const scope = scopeView(unit.scope);
  const chapter =
    chapters !== undefined
      ? chapters.find((item) => item.storyUnitId === unitId)
      : undefined;
  const dependencyChips = (unit.blockState?.dependencyIds ?? [])
    .map((id) => findNode(snapshot.tree, id))
    .filter((node): node is StoryOutlineTreeNode => node !== undefined);
  const leafChildren = unit.children;
  const hasRelations =
    dependencyChips.length > 0 ||
    (coreUnit?.leaf?.characters.length ?? 0) > 0 ||
    leafChildren.length > 0 ||
    chapter !== undefined;
  return (
    <div className={styles.panel} data-workspace={workspaceId}>
      <div className={styles.card}>
        <div className={styles.unitHead}>
          <StatusChip variant={scope.variant} title={unit.scope}>
            {scope.label}
          </StatusChip>
          <h2 className={styles.title}>{unit.title}</h2>
        </div>
        <div className={styles.unitSub}>
          storyUnit {unit.unitId} · scope {unit.scope} · orderKey {unit.orderKey} · v{unit.entityVersion}
          {unit.parentTitle !== undefined ? ` · 父 ${unit.parentTitle}` : ""}
        </div>
        <div className={styles.statRow}>
          <StatusChip variant={plan.variant}>{plan.label}</StatusChip>
          <StatusChip variant={real.variant}>{real.label}</StatusChip>
          {unit.progress !== undefined ? (
            <>
              <span className={styles.miniBar} aria-hidden="true">
                <i
                  style={{
                    width: `${Math.round((unit.progress.completed / unit.progress.total) * 100)}%`,
                  }}
                />
              </span>
              <span className={styles.progressNum}>
                {unit.progress.completed} / {unit.progress.total} 叶单元已完成
              </span>
            </>
          ) : null}
        </div>
        {unit.blockState !== undefined ? (
          <div className={`${styles.banner} ${styles.warn}`}>
            <Icon icon={AlertTriangle} size="sm" />
            <span>
              受阻 · {unit.blockState.reasonCode !== undefined ? (BLOCK_REASON_LABEL[unit.blockState.reasonCode] ?? unit.blockState.reasonCode) : "其他"}
              ：{unit.blockState.note ?? "（未填说明）"}
            </span>
          </div>
        ) : null}
        {unit.abandonment !== undefined ? (
          <div className={`${styles.banner} ${styles.faint}`}>
            <Icon icon={X} size="sm" />
            <span>
              已废弃 · {ABANDON_REASON_LABEL[unit.abandonment.reasonCode]}：{unit.abandonment.note ?? ""}
            </span>
          </div>
        ) : null}
        <div className={styles.sectionHead}>意图 · intent</div>
        <p className={styles.cardP}>{coreUnit?.intent ?? "（尚未填写——这个单元要达成什么）"}</p>
        <div className={styles.sectionHead}>梗概 · synopsis</div>
        <p className={styles.cardP}>{coreUnit?.synopsis ?? "（尚未填写情节梗概）"}</p>
        {(chapter !== undefined || onDiscuss !== undefined) && (
          <div className={styles.jumpActions}>
            {chapter !== undefined && onOpenChapter !== undefined ? (
              <Button
                variant="secondary"
                size="sm"
                leadingIcon={<Icon icon={ScrollText} size="xs" />}
                onClick={() => onOpenChapter(chapter.chapterId)}
              >
                在正文中查看
              </Button>
            ) : null}
            {onDiscuss !== undefined ? (
              <Button
                variant="ghost"
                size="sm"
                leadingIcon={<Icon icon={MessageSquare} size="xs" />}
                onClick={onDiscuss}
              >
                在对话中讨论
              </Button>
            ) : null}
          </div>
        )}
      </div>
      {unit.scope === "scene" ? (
        <LeafPlanCard
          leaf={coreUnit?.leaf}
          characterNames={characterNames}
          locationNames={locationNames}
          onOpenCharacter={onOpenCharacter}
          onOpenLocation={onOpenLocation}
        />
      ) : null}
      {unitParagraphs !== undefined ? (
        <UnitParagraphsCard
          unitParagraphs={unitParagraphs}
          publishedParagraphIds={publishedParagraphIds}
        />
      ) : null}
      <div className={styles.card}>
        <h3 className={styles.cardTitle}>关联</h3>
        {hasRelations ? (
          <>
            {dependencyChips.length > 0 ? (
              <>
                <div className={styles.sectionHead}>阻塞依赖 · dependencyIds</div>
                <div className={styles.refChips}>
                  {dependencyChips.map((dep) => (
                    <RefChip
                      key={dep.unitId}
                      icon={AlertTriangle}
                      label={dep.title}
                      onClick={() => outlineTree.selectUnit(dep.unitId)}
                    />
                  ))}
                </div>
              </>
            ) : null}
            {(coreUnit?.leaf?.characters.length ?? 0) > 0 ? (
              <>
                <div className={styles.sectionHead}>出场人物 · leaf.characters</div>
                <div className={styles.refChips}>
                  {(coreUnit?.leaf?.characters ?? []).map((binding) => {
                    const involvement = binding.involvement;
                    const tag =
                      involvement !== undefined
                        ? [
                            involvement.roles.map((role) => LEAF_ROLE_LABEL[role]).join("/"),
                            LEAF_PRESENCE_LABEL[involvement.presence],
                          ]
                            .filter(Boolean)
                            .join(" · ")
                        : "";
                    return (
                      <RefChip
                        key={binding.characterId}
                        icon={UserRound}
                        label={characterNames?.get(binding.characterId)?.name ?? binding.characterId}
                        tag={tag}
                        onClick={
                          onOpenCharacter !== undefined
                            ? () => onOpenCharacter(binding.characterId)
                            : undefined
                        }
                      />
                    );
                  })}
                </div>
              </>
            ) : null}
            {leafChildren.length > 0 ? (
              <>
                <div className={styles.sectionHead}>子单元</div>
                <div className={styles.refChips}>
                  {leafChildren.map((child) => (
                    <RefChip
                      key={child.unitId}
                      icon={ListTree}
                      label={child.title}
                      onClick={() => outlineTree.selectUnit(child.unitId)}
                    />
                  ))}
                </div>
              </>
            ) : null}
            {chapter !== undefined ? (
              <>
                <div className={styles.sectionHead}>发布章 · 从场景选段</div>
                <div className={styles.refChips}>
                  {onOpenChapter !== undefined ? (
                    <RefChip
                      icon={ScrollText}
                      label={chapter.title}
                      onClick={() => onOpenChapter(chapter.chapterId)}
                    />
                  ) : (
                    <RefChip icon={ScrollText} label={chapter.title} />
                  )}
                </div>
              </>
            ) : null}
          </>
        ) : (
          <span className={styles.noRelations}>无关联条目</span>
        )}
      </div>
      <div className={styles.dFoot}>
        <Button variant="ghost" size="sm" leadingIcon={<Icon icon={Pencil} size="xs" />} onClick={() => setEditOpen(true)}>
          编辑
        </Button>
        <Button variant="ghost" size="sm" leadingIcon={<Icon icon={ListPlus} size="xs" />} onClick={() => setChildOpen(true)}>
          新建子单元
        </Button>
        <Button
          variant="ghost"
          size="sm"
          leadingIcon={<Icon icon={Trash2} size="xs" />}
          onClick={() => {
            if (coreUnit !== undefined) setDeleteOpen(true);
          }}
        >
          删除
        </Button>
      </div>
      <StoryUnitEditDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        title="编辑大纲单元"
        error={snapshot.error?.message}
        initial={
          coreUnit !== undefined
            ? {
                title: coreUnit.title,
                intent: coreUnit.intent ?? "",
                synopsis: coreUnit.synopsis ?? "",
                scope: coreUnit.scope,
              }
            : undefined
        }
        onSubmit={(input) =>
          outlineTree.updateStoryUnit(
            unitId,
            { title: input.title, intent: input.intent, synopsis: input.synopsis, scope: input.scope },
            coreUnit!.entityVersion,
          )
        }
      />
      <StoryUnitEditDialog
        open={childOpen}
        onOpenChange={setChildOpen}
        title="新建子单元"
        error={snapshot.error?.message}
        onSubmit={(input) =>
          outlineTree.createStoryUnit({ parentId: unitId as never, ...input })
        }
      />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="删除大纲单元"
        description={`确定删除大纲单元「${unit.title}」？其子单元将一并删除。`}
        onConfirm={() => {
          setDeleteOpen(false);
          if (coreUnit !== undefined) void outlineTree.deleteStoryUnit(unitId, coreUnit.entityVersion);
        }}
      />
    </div>
  );
}
