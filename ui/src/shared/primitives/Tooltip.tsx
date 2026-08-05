/**
 * Tooltip
 *
 * 基于 @radix-ui/react-tooltip 的提示浮层。delay 默认 300ms。
 */
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";
import styles from "./Tooltip.module.css";

export interface TooltipProps {
  readonly content: ReactNode;
  readonly side?: "top" | "right" | "bottom" | "left";
  readonly delay?: number; // ms，默认 300
  readonly children: ReactNode;
}

export function Tooltip({ content, side = "top", delay = 300, children }: TooltipProps) {
  return (
    <TooltipPrimitive.Provider delayDuration={delay}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content className={styles.content} side={side} sideOffset={6}>
            {content}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
