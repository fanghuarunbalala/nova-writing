/**
 * Kbd
 *
 * 键盘快捷键提示。
 */
import type { ReactNode } from "react";
import styles from "./Kbd.module.css";

export interface KbdProps {
  readonly children: ReactNode; // 如 "Ctrl+Shift+P"
}

export function Kbd({ children }: KbdProps) {
  return <kbd className={styles.kbd}>{children}</kbd>;
}
