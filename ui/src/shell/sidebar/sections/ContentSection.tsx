/**
 * ContentSection
 *
 * 侧栏内容组（对齐原型）：大纲/正文/人物/地点 + 计数，点击切到内容视图对应 tab。
 */
import { useExternalStore } from "../../../shared/state/useExternalStore.js";
import type { NovelOverviewStore } from "../../../domains/novel/overview/NovelOverviewStore.js";
import type { ContentTab } from "../../main/contentTab.js";
import { SidebarSection } from "../SidebarSection.js";
import styles from "./ContentSection.module.css";

const PANES: ReadonlyArray<{ readonly value: ContentTab; readonly label: string; readonly countKey: "storyUnitCount" | "chapterCount" | "characterCount" | "locationCount" }> = [
  { value: "outline", label: "大纲", countKey: "storyUnitCount" },
  { value: "manuscript", label: "正文", countKey: "chapterCount" },
  { value: "characters", label: "人物", countKey: "characterCount" },
  { value: "locations", label: "地点", countKey: "locationCount" },
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
          {pane.label}
          <span className={styles.count}>{snapshot.counts[pane.countKey]}</span>
        </button>
      ))}
    </SidebarSection>
  );
}
