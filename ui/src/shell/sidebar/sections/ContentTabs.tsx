/**
 * ContentTabs
 *
 * 内容视图资料位四段 tab（PRD SB-5）：大纲/正文/人物/地点，图标 + 名称，
 * 点击切换 contentTab（目录与主区随之切换）。计数在下方 dirHead 目录标题行。
 */
import { ListTree, MapPin, ScrollText, UserRound, type LucideIcon } from "lucide-react";
import { Icon } from "../../../shared/primitives/Icon.js";
import type { ContentTab } from "../../main/contentTab.js";
import styles from "./directory.module.css";

const TABS: ReadonlyArray<{
  readonly value: ContentTab;
  readonly label: string;
  readonly icon: LucideIcon;
}> = [
  { value: "outline", label: "大纲", icon: ListTree },
  { value: "manuscript", label: "正文", icon: ScrollText },
  { value: "characters", label: "人物", icon: UserRound },
  { value: "locations", label: "地点", icon: MapPin },
];

export interface ContentTabsProps {
  readonly active: ContentTab;
  readonly onSelect: (pane: ContentTab) => void;
}

export function ContentTabs({ active, onSelect }: ContentTabsProps) {
  return (
    <div className={styles.segTabs} role="tablist" aria-label="内容资料位">
      {TABS.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          className={styles.segTab}
          aria-selected={active === tab.value}
          onClick={() => onSelect(tab.value)}
        >
          <Icon icon={tab.icon} size="sm" />
          <span>{tab.label}</span>
        </button>
      ))}
    </div>
  );
}
