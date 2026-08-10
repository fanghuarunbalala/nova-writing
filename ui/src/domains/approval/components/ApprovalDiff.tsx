/**
 * ApprovalDiff
 *
 * 编辑审批「改动项」旧→新对比：对 patch 的每个字段，旧值取自当前实体内容、
 * 新值取自 patch。值格式化复用 ParameterView 规则（基本值/枚举翻译/基本值
 * 数组顿号/嵌套对象紧凑 JSON）。
 *
 * Renders old→new change rows for an edit approval: old value from the current
 * entity content, new value from the patch. Value formatting mirrors ParameterView.
 */
import type { JSX } from "react";
import type { JsonObject, JsonValue } from "@novel/core";
import { paramKeyLabel, paramValueLabel } from "../paramLabels.js";
import styles from "./ApprovalDiff.module.css";

function isPrimitive(value: JsonValue): boolean {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function formatValue(field: string, value: JsonValue | undefined): string {
  if (value === undefined) return "—";
  if (value === null) return "空";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "string") return paramValueLabel(field, value) ?? value;
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "空";
    if (value.every(isPrimitive)) {
      return value
        .map((item) =>
          typeof item === "string"
            ? (paramValueLabel(field, item) ?? item)
            : String(item ?? "空"),
        )
        .join("、");
    }
    return JSON.stringify(value);
  }
  return JSON.stringify(value);
}

export interface ApprovalDiffProps {
  /** 编辑 patch 字段。Fields being edited. */
  readonly patch: JsonObject;
  /** 当前实体内容（旧值来源）。Current entity content. */
  readonly current: JsonObject;
}

export function ApprovalDiff({
  patch,
  current,
}: ApprovalDiffProps): JSX.Element {
  return (
    <div className={styles.diffBlock}>
      <div className={styles.diffHead}>改动项</div>
      {Object.entries(patch).map(([field, newValue]) => (
        <div key={field} className={styles.diffRow}>
          <span className={styles.diffField}>
            {paramKeyLabel(field) ?? field}
          </span>
          <span className={styles.diffOld}>
            {formatValue(field, current[field])}
          </span>
          <span className={styles.diffArrow}>→</span>
          <span className={styles.diffNew}>{formatValue(field, newValue)}</span>
        </div>
      ))}
    </div>
  );
}
