/**
 * ContentSection
 *
 * 侧栏内容组（对齐原型 .side-item）：大纲/正文/人物/地点 + lucide 图标
 * （经 Icon 原语统一 20px/1.8 描边）+ 计数，点击切到内容视图对应 tab。
 */
import { ListTree, MapPin, ScrollText, UserRound, type LucideIcon } from "lucide-react";
import { useExternalStore } from "../../../shared/state/useExternalStore.js";
import { Icon } from "../../../shared/primitives/Icon.js";
import type { NovelOverviewStore } from "../../../domains/novel/overview/NovelOverviewStore.js";
import type { ContentTab } from "../../main/contentTab.js";
import { SidebarSection } from "../SidebarSection.js";
import styles from "./ContentSection.module.css";

type PaneIconKey = "outline" | "manuscript" | "character" | "location";

const PANE_ICONS: Record<PaneIconKey, LucideIcon> = {
  outline: ListTree,
  manuscript: ScrollText,
  character: UserRound,
  location: MapPin,
};

const PANES: ReadonlyArray<{
  readonly value: ContentTab;
  readonly label: string;
  readonly icon: PaneIconKey;
  readonly countKey: "storyUnitCount" | "chapterCount" | "characterCount" | "locationCount";
}> = [
  { value: "outline", label: "大纲", icon: "outline", countKey: "storyUnitCount" },
  { value: "manuscript", label: "正文", icon: "manuscript", countKey: "chapterCount" },
  { value: "characters", label: "人物", icon: "character", countKey: "characterCount" },
  { value: "locations", label: "地点", icon: "location", countKey: "locationCount" },
];

export interface ContentSectionProps {
  readonly overview: NovelOverviewStore;
  readonly activePane: ContentTab;
  readonly onSelectPane: (pane: ContentTab) => void;
}

export function ContentSection({ overview, activePane, onSelectPane }: ContentSectionProps) {
  const snapshot = useExternalStore(overview);
  return (
    <SidebarSection label="内容">
      {PANES.map((pane) => (
        <button
          key={pane.value}
          type="button"
          className={[styles.item, activePane === pane.value ? styles.active : ""].filter(Boolean).join(" ")}
          onClick={() => onSelectPane(pane.value)}
        >
          <Icon icon={PANE_ICONS[pane.icon]} size="lg" />
          <span className={styles.label}>{pane.label}</span>
          <span className={styles.count}>{snapshot.counts[pane.countKey]}</span>
        </button>
      ))}
    </SidebarSection>
  );
}
