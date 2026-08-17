/**
 * LocationDetailPanel
 *
 * 地点档案（PL-1，demo locHTML）：46px 图标头像 + 18px 名称 +
 * kicker「地点 · vN · 现状：{locState}」+ 右侧「编辑」次级钮（删除降噪为
 * 图标钮）；卡片 = 简介 → 作者备注（楷体）→ 关联单元 chips（无初始状态；
 * 空关联提示「尚未关联 —— 计划视图有待办提醒」）。
 */
import { ListTree, MapPin, Pencil, Trash2 } from "lucide-react";
import type { LocationDetail } from "../store/LocationStore.js";
import { Icon } from "../../../../shared/primitives/Icon.js";
import styles from "./LocationDetailPanel.module.css";

export interface LocationDetailPanelProps {
  readonly workspaceId: string;
  readonly locationId: string;
  readonly detail?: LocationDetail;
  /** 关联单元 chip 点击 → 跳内容视图大纲单元详情 */
  readonly onOpenUnit?: (unitId: string) => void;
  /** 关联单元覆盖（大纲 leaf 绑定派生；缺省回落 detail.relatedUnits） */
  readonly relatedUnitLinks?: readonly { readonly unitId: string; readonly label: string }[];
  /** 编辑入口（宿主打开编辑对话框） */
  readonly onEdit?: () => void;
  /** 删除入口（宿主确认后删除） */
  readonly onDelete?: () => void;
}

const STATE_LABEL: Record<LocationDetail["locState"], string> = {
  filed: "已建档",
  "draft-new": "草稿新增",
};

export function LocationDetailPanel({
  workspaceId,
  detail,
  onOpenUnit,
  relatedUnitLinks,
  onEdit,
  onDelete,
}: LocationDetailPanelProps) {
  if (detail === undefined) {
    return <div className={styles.panel}>加载地点详情…</div>;
  }
  const relatedUnits = relatedUnitLinks ?? detail.relatedUnits;
  return (
    <div className={styles.panel} data-workspace={workspaceId}>
      <div className={styles.head}>
        <span className={styles.avatar} aria-hidden="true">
          <Icon icon={MapPin} size="md" />
        </span>
        <div className={styles.headText}>
          <h2 className={styles.name}>{detail.name}</h2>
          <div className={styles.kicker}>
            地点 · v{detail.version} · 现状：{STATE_LABEL[detail.locState]}
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
              aria-label="删除地点"
              title="删除地点"
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
      {detail.profile !== "" ? (
        <section className={styles.card}>
          <h3 className={styles.cardTitle}>作者备注</h3>
          <p className={styles.cardPKai}>{detail.profile}</p>
        </section>
      ) : null}
      <section className={styles.card}>
        <h3 className={styles.cardTitle}>关联单元</h3>
        <div className={styles.refChips}>
          {relatedUnits.length > 0 ? (
            relatedUnits.map((unit) => (
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
            <span className={styles.emptyHint}>尚未关联 —— 计划视图有待办提醒</span>
          )}
        </div>
      </section>
    </div>
  );
}
