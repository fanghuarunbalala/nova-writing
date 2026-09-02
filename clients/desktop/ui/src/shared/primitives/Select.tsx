/**
 * Select
 *
 * 下拉选择原语：统一边框/圆角/焦点态（FormControl 样式）。
 */
import type { SelectHTMLAttributes } from "react";
import styles from "./FormControl.module.css";

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

export function Select({ className, ...rest }: SelectProps) {
  return (
    <select
      className={[styles.control, className ?? ""].filter(Boolean).join(" ")}
      {...rest}
    />
  );
}
