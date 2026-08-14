/**
 * Textarea
 *
 * 多行输入原语：统一边框/圆角/焦点态（FormControl 样式，可纵向拖拽调高）。
 */
import type { TextareaHTMLAttributes } from "react";
import styles from "./FormControl.module.css";

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export function Textarea({ className, ...rest }: TextareaProps) {
  return (
    <textarea
      className={[styles.control, className ?? ""].filter(Boolean).join(" ")}
      {...rest}
    />
  );
}
