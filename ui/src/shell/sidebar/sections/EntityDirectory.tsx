/**
 * EntityDirectory
 *
 * 人物 / 地点目录（PRD SB-9）：首字头像 + 名称 + 角色/现状副行；选中态 accent。
 * 通用实体列表——由调用方传入 items（character/location summary 投影）。
 */
import { memo } from "react";
import styles from "./directory.module.css";

export interface EntityDirectoryItem {
  readonly id: string;
  readonly avatarText: string;
  readonly title: string;
  readonly subtitle: string;
}

export interface EntityDirectoryProps {
  readonly items: readonly EntityDirectoryItem[];
  readonly activeId?: string;
  readonly onSelect: (id: string) => void;
  readonly emptyLabel: string;
}

export const EntityDirectory = memo(function EntityDirectory({
  items,
  activeId,
  onSelect,
  emptyLabel,
}: EntityDirectoryProps) {
  if (items.length === 0) {
    return <div className={styles.empty}>{emptyLabel}</div>;
  }
  return (
    <div className={styles.directory} role="listbox" aria-label="档案目录">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="option"
          aria-selected={item.id === activeId}
          className={styles.row}
          data-active={item.id === activeId || undefined}
          onClick={() => onSelect(item.id)}
        >
          <span className={styles.avatar} aria-hidden="true">
            {item.avatarText}
          </span>
          <span className={styles.text}>
            <span className={styles.title}>{item.title}</span>
            <span className={styles.subtitle}>{item.subtitle}</span>
          </span>
        </button>
      ))}
    </div>
  );
});
