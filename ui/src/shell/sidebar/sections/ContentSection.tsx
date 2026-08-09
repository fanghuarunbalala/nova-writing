/**
 * ContentSection
 *
 * 侧栏内容组（对齐原型 .side-item）：大纲/正文/人物/地点 + 20×20 内联
 * SVG 图标（stroke-width 1.7）+ 计数，点击切到内容视图对应 tab。
 */
import type { ReactNode } from "react";
import { useExternalStore } from "../../../shared/state/useExternalStore.js";
import type { NovelOverviewStore } from "../../../domains/novel/overview/NovelOverviewStore.js";
import type { ContentTab } from "../../main/contentTab.js";
import { SidebarSection } from "../SidebarSection.js";
import styles from "./ContentSection.module.css";

type PaneIconKey = "outline" | "manuscript" | "character" | "location";

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

/** 20×20 stroke 1.7 线稿图标（原型 .side-item 内联 SVG）。 */
function PaneIcon({ icon }: { readonly icon: PaneIconKey }): ReactNode {
  switch (icon) {
    case "outline":
      return (
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="4" cy="5" r="1" />
          <circle cx="4" cy="10" r="1" />
          <circle cx="4" cy="15" r="1" />
          <path d="M8 5h8M8 10h8M8 15h8" />
        </svg>
      );
    case "manuscript":
      return (
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M5 2.5h6.5L16 7v9.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1z" />
          <path d="M11 2.5V7h5" />
          <path d="M7 11h6M7 14h4" />
        </svg>
      );
    case "character":
      return (
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="10" cy="6.5" r="3" />
          <path d="M4 17c1-3.2 3.2-4.5 6-4.5s5 1.3 6 4.5" />
        </svg>
      );
    case "location":
      return (
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M10 17.5S4 12.2 4 8a6 6 0 0 1 12 0c0 4.2-6 9.5-6 9.5z" />
          <circle cx="10" cy="8" r="2.2" />
        </svg>
      );
  }
}

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
          <PaneIcon icon={pane.icon} />
          <span className={styles.label}>{pane.label}</span>
          <span className={styles.count}>{snapshot.counts[pane.countKey]}</span>
        </button>
      ))}
    </SidebarSection>
  );
}
