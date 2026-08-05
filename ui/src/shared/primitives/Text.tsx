/**
 * Text
 *
 * 排版原语：字号/字重/颜色/mono，按需渲染 span/p/div。
 */
import type { ElementType, ReactNode } from "react";
import styles from "./Text.module.css";

export type TextSize = "xs" | "sm" | "md" | "lg" | "xl";
export type TextWeight = "regular" | "medium" | "semibold" | "bold" | "heavy";
export type TextColor = "fg" | "muted" | "faint" | "accent" | "danger" | "success" | "warn";

export interface TextProps {
  readonly size?: TextSize;
  readonly weight?: TextWeight;
  readonly color?: TextColor;
  readonly as?: "span" | "p" | "div";
  readonly mono?: boolean;
  readonly className?: string;
  readonly children: ReactNode;
}

export function Text({
  size = "md",
  weight = "regular",
  color = "fg",
  as = "span",
  mono = false,
  className,
  children,
}: TextProps) {
  const Component = as as ElementType;
  return (
    <Component
      className={[
        styles.text,
        styles[size],
        styles[weight],
        styles[color],
        mono ? styles.mono : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </Component>
  );
}
