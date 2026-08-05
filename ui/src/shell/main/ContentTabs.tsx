/**
 * ContentTabs
 *
 * 内容视图四 tab 切换（本地 state，不进 MainViewRouter）。
 * variant="fill" 对齐原型 .pane-tabs（accent 浅底激活态）。
 */
import { Tabs, TabsContent } from "../../shared/primitives/Tabs.js";
import type { ReactNode } from "react";

export type ContentTab = "outline" | "manuscript" | "characters" | "locations";

const CONTENT_TABS: ReadonlyArray<{ readonly value: ContentTab; readonly label: string }> = [
  { value: "outline", label: "大纲" },
  { value: "manuscript", label: "正文" },
  { value: "characters", label: "角色" },
  { value: "locations", label: "地点" },
];

export interface ContentTabsProps {
  readonly value: ContentTab;
  readonly onChange: (value: ContentTab) => void;
  readonly children: (tab: ContentTab) => ReactNode;
}

export function ContentTabs({ value, onChange, children }: ContentTabsProps) {
  return (
    <Tabs
      value={value}
      onValueChange={(next) => onChange(next as ContentTab)}
      tabs={CONTENT_TABS}
      variant="fill"
    >
      {CONTENT_TABS.map((tab) => (
        <TabsContent key={tab.value} value={tab.value}>
          {children(tab.value)}
        </TabsContent>
      ))}
    </Tabs>
  );
}
