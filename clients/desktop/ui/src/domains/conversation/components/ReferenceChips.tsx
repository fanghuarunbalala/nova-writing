/**
 * ReferenceChips
 *
 * 引用 chips 行（composer 引用栏 removable / 用户气泡与排队幽灵项只读 共用）：
 * 类型图标 + 名称，removable 时带 × 移除钮。数据来自 ComposerDraftStore 的
 * 结构化引用；消息气泡内的 chips 由 splitTrailingReferences 从文本尾部标签
 * 剥离后经本组件渲染（dense 紧凑变体，对齐 demo .msgRefs）。chip 点击经
 * onReferenceClick 反向定位右栏详情页。
 */
import { ListTree, MapPin, Quote, ScrollText, User, X, type LucideIcon } from "lucide-react";
import { Icon } from "../../../shared/primitives/Icon.js";
import type { ComposerReference, ComposerReferenceKind } from "../store/ComposerDraftStore.js";
import styles from "./ReferenceChips.module.css";

const ICON_BY_KIND: Record<ComposerReferenceKind, LucideIcon> = {
  character: User,
  location: MapPin,
  outline: ListTree,
  chapter: ScrollText,
  paragraph: Quote,
};

const KIND_LABEL: Record<ComposerReferenceKind, string> = {
  character: "人物",
  location: "地点",
  outline: "大纲",
  chapter: "正文",
  paragraph: "段落",
};

export interface ReferenceChipsProps {
  readonly references?: readonly ComposerReference[];
  readonly removable?: boolean;
  readonly onRemove?: (reference: ComposerReference) => void;
  /** 紧凑变体（气泡内/幽灵项，demo .msgRefs .refChip：更小内距与字号） */
  readonly dense?: boolean;
  /** chip 点击（反向定位右栏详情页）；提供时 chip 渲染为 button */
  readonly onReferenceClick?: (reference: ComposerReference) => void;
}

export function ReferenceChips({
  references,
  removable = false,
  onRemove,
  dense = false,
  onReferenceClick,
}: ReferenceChipsProps) {
  if (references === undefined || references.length === 0) return null;
  return (
    <div className={[styles.tray, dense ? styles.trayDense : ""].filter(Boolean).join(" ")}>
      {references.map((reference) => {
        const icon = ICON_BY_KIND[reference.kind];
        const body = (
          <>
            <Icon icon={icon} size="xs" />
            <span className={styles.chipLabel}>{reference.label}</span>
            {removable ? (
              <button
                type="button"
                className={styles.chipX}
                aria-label={`移除引用 ${reference.label}`}
                onClick={() => onRemove?.(reference)}
              >
                <Icon icon={X} size="xs" />
              </button>
            ) : null}
          </>
        );
        return onReferenceClick !== undefined ? (
          <button
            key={`${reference.kind}:${reference.id}`}
            type="button"
            className={[styles.chip, dense ? styles.chipDense : ""].filter(Boolean).join(" ")}
            title={`${KIND_LABEL[reference.kind]} · ${reference.label}（点击在右栏定位）`}
            onClick={() => onReferenceClick(reference)}
          >
            {body}
          </button>
        ) : (
          <span
            key={`${reference.kind}:${reference.id}`}
            className={[styles.chip, dense ? styles.chipDense : ""].filter(Boolean).join(" ")}
            title={`${KIND_LABEL[reference.kind]} · ${reference.label}`}
          >
            {body}
          </span>
        );
      })}
    </div>
  );
}
