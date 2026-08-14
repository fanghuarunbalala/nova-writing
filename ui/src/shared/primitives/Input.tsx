/**
 * Input
 *
 * 文本输入原语：统一边框/圆角/焦点态（FormControl 样式，与 Textarea/Select 同源）。
 */
import type { InputHTMLAttributes } from "react";
import styles from "./FormControl.module.css";

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export function Input({ className, ...rest }: InputProps) {
  return (
    <input
      className={[styles.control, className ?? ""].filter(Boolean).join(" ")}
      {...rest}
    />
  );
}
