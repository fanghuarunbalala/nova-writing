/**
 * Avatar
 *
 * 头像。text 为 1-2 字符（首字/缩写）；user/agent 两种身份配色。
 */
import styles from "./Avatar.module.css";

export type AvatarVariant = "user" | "agent";

export interface AvatarProps {
  readonly variant: AvatarVariant;
  readonly text: string; // 1-2 字符
  readonly size?: "sm" | "md";
}

export function Avatar({ variant, text, size = "md" }: AvatarProps) {
  return (
    <span className={[styles.avatar, styles[variant], styles[size]].filter(Boolean).join(" ")} aria-hidden="true">
      {text.slice(0, 2)}
    </span>
  );
}
