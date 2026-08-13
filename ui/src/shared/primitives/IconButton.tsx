/**
 * IconButton
 *
 * 固定尺寸图标按钮（md 34x34 / sm 28x28），aria-label 必填。
 */
import type { ButtonHTMLAttributes, ReactNode } from "react";
import styles from "./IconButton.module.css";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly label: string; // aria-label，必填
  readonly size?: "sm" | "md";
  readonly children: ReactNode; // icon
}

export function IconButton({
  label,
  size = "md",
  className,
  children,
  type = "button",
  ...rest
}: IconButtonProps) {
  const classes = [styles.iconButton, styles[size], className ?? ""].filter(Boolean).join(" ");
  return (
    <button type={type} className={classes} aria-label={label} {...rest}>
      {children}
    </button>
  );
}
