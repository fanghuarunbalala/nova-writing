/**
 * Icon
 *
 * lucide-react 图标封装：统一尺寸与描边，颜色走 TextColor token。
 */
import type { LucideIcon } from "lucide-react";
import styles from "./Icon.module.css";
import type { TextColor } from "./Text.js";

export interface IconProps {
  readonly icon: LucideIcon;
  readonly size?: "xs" | "sm" | "md" | "lg";
  readonly strokeWidth?: number;
  readonly color?: TextColor | "currentColor";
}

export function Icon({
  icon: IconComponent,
  size = "md",
  strokeWidth = 1.8,
  color = "currentColor",
}: IconProps) {
  return (
    <IconComponent
      className={[
        styles.icon,
        styles[size],
        color === "currentColor" ? "" : styles[color],
      ]
        .filter(Boolean)
        .join(" ")}
      strokeWidth={strokeWidth}
      aria-hidden="true"
    />
  );
}
