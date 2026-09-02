/**
 * Tabs
 *
 * 基于 @radix-ui/react-tabs 的受控标签页。variant line / pill / fill。
 * - line: 下划线（inspector 默认）
 * - pill: 胶囊容器（composer mode bar）
 * - fill: 填充背景（content pane tabs，原型 .pane-tab）
 */
import * as TabsPrimitive from "@radix-ui/react-tabs";
import type { ReactNode } from "react";
import { Badge } from "./Badge.js";
import styles from "./Tabs.module.css";

export interface TabItem {
  readonly value: string;
  readonly label: ReactNode;
  readonly count?: number;
  readonly disabled?: boolean;
}

export interface TabsProps {
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  readonly tabs: readonly TabItem[];
  readonly children?: ReactNode; // TabsContent 列表（纯切换条可省略）
  readonly variant?: "line" | "pill" | "fill";
}

export function Tabs({ value, onValueChange, tabs, children, variant = "line" }: TabsProps) {
  return (
    <TabsPrimitive.Root value={value} onValueChange={onValueChange} className={styles.root}>
      <TabsPrimitive.List className={[styles.list, styles[variant]].filter(Boolean).join(" ")}>
        {tabs.map((tab) => (
          <TabsPrimitive.Trigger
            key={tab.value}
            value={tab.value}
            disabled={tab.disabled}
            className={[
              styles.tab,
              variant === "pill" ? styles.tabPill : "",
              variant === "fill" ? styles.tabFill : "",
            ].filter(Boolean).join(" ")}
          >
            {tab.label}
            {tab.count !== undefined ? <Badge count={tab.count} variant="warn" /> : null}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
      {children}
    </TabsPrimitive.Root>
  );
}

export interface TabsContentProps {
  readonly value: string;
  readonly children: ReactNode;
}

export function TabsContent({ value, children }: TabsContentProps) {
  return (
    <TabsPrimitive.Content value={value} className={styles.content}>
      {children}
    </TabsPrimitive.Content>
  );
}
