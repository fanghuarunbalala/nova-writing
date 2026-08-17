/**
 * CharacterDetailPanel
 *
 * 角色档案（PM-1/2，demo charHTML）：46px 首字头像 + 18px 姓名 +
 * kicker「角色定位 · vN」+ 右侧「编辑」次级钮（删除降噪为图标钮）；
 * 卡片顺序：简介 → 初始状态 → 作者备注（楷体 muted）→ 关联单元 chips
 * （空时「尚未关联」；chip 点击跳内容视图大纲单元详情）。
 */
import { ListTree, Pencil, Trash2 } from "lucide-react";
import type { CharacterDetail } from "../store/CharacterStore.js";
import { Icon } from "../../../../shared/primitives/Icon.js";
import styles from "./CharacterDetailPanel.module.css";

export interface CharacterDetailPanelProps {
  readonly workspaceId: string;
  readonly characterId: string;
  readonly detail?: CharacterDetail;
  /** 关联单元 chip 点击 → 跳内容视图大纲单元详情 */
  readonly onOpenUnit?: (unitId: string) => void;
  /** 编辑入口（宿主打开编辑对话框） */
  readonly onEdit?: () => void;
  /** 删除入口（宿主确认后删除） */
  readonly onDelete?: () => void;
}

export function CharacterDetailPanel({
  workspaceId,
  detail,
  onOpenUnit,
  onEdit,
  onDelete,
}: CharacterDetailPanelProps) {
  if (detail === undefined) {
    return <div className={styles.panel}>加载角色详情…</div>;
  }
  return (
    <div className={styles.panel} data-workspace={workspaceId}>
      <div className={styles.head}>
        <span className={styles.avatar} aria-hidden="true">{detail.avatarText}</span>
        <div className={styles.headText}>
          <h2 className={styles.name}>{detail.name}</h2>
          <div className={styles.kicker}>
            {detail.role} · v{detail.version}
          </div>
        </div>
        <div className={styles.actions}>
          {onEdit !== undefined ? (
            <button type="button" className={styles.editButton} onClick={onEdit}>
              <Icon icon={Pencil} size="xs" />
              编辑
            </button>
          ) : null}
          {onDelete !== undefined ? (
            <button
              type="button"
              className={styles.iconButton}
              aria-label="删除角色"
              title="删除角色"
              onClick={onDelete}
            >
              <Icon icon={Trash2} size="xs" />
            </button>
          ) : null}
        </div>
      </div>
      <section className={styles.card}>
        <h3 className={styles.cardTitle}>简介</h3>
        <p className={styles.cardP}>{detail.summary !== "" ? detail.summary : "（尚未填写简介）"}</p>
      </section>
      <section className={styles.card}>
        <h3 className={styles.cardTitle}>初始状态</h3>
        <p className={styles.cardP}>
          {detail.initialState !== "" ? detail.initialState : "（尚未填写初始状态）"}
        </p>
      </section>
      {detail.profile !== "" ? (
        <section className={styles.card}>
          <h3 className={styles.cardTitle}>作者备注</h3>
          <p className={styles.cardPKai}>{detail.profile}</p>
        </section>
      ) : null}
      <section className={styles.card}>
        <h3 className={styles.cardTitle}>关联单元</h3>
        <div className={styles.refChips}>
          {detail.relatedUnits.length > 0 ? (
            detail.relatedUnits.map((unit) => (
              <button
                key={unit.unitId}
                type="button"
                className={styles.refChip}
                onClick={onOpenUnit !== undefined ? () => onOpenUnit(unit.unitId) : undefined}
              >
                <Icon icon={ListTree} size="xs" />
                {unit.label}
              </button>
            ))
          ) : (
            <span className={styles.emptyHint}>尚未关联</span>
          )}
        </div>
      </section>
    </div>
  );
}
