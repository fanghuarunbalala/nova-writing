/**
 * ParameterView
 *
 * 审批参数递归渲染（对齐原型 .params 网格）：对象逐字段「中文标签 + 值」，
 * 嵌套对象 / 对象数组递归为子区块，基本值数组顿号连接，null 显示「空」，
 * 已知枚举值翻译为中文。长文本默认 4 行截断，可「展开全文」。
 *
 * Recursively renders tool arguments as Chinese-labelled rows matching the
 * prototype .params grid; nested objects and object arrays recurse into
 * sub-blocks; primitive arrays join with 、; known enum values are translated.
 * Long text is clamped to 4 lines with an expand toggle.
 */
import { useState, type JSX } from "react";
import type { JsonObject, JsonValue } from "@novel/core";
import {
  isParamFieldHidden,
  operationGlyph,
  paramFieldRank,
  paramKeyLabel,
  paramValueLabel,
} from "../paramLabels.js";
import styles from "./ParameterView.module.css";

const LONG_TEXT_CHARS = 120;

/** 变更类型（方案 E diff 色块）。Operation tone for diff-block styling. */
export type ParameterTone = "add" | "edit" | "delete" | undefined;

function toneClass(tone: ParameterTone): string | undefined {
  if (tone === "add") return styles.toneAdd;
  if (tone === "edit") return styles.toneEdit;
  if (tone === "delete") return styles.toneDel;
  return undefined;
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPrimitive(value: JsonValue): value is string | number | boolean | null {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function primitiveText(
  value: string | number | boolean | null,
  field?: string,
): string {
  if (value === null) return "空";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "string") return paramValueLabel(field ?? "", value) ?? value;
  return String(value);
}

/** 长文本 4 行截断 + 展开全文。Clamped long text with expand toggle. */
function LongText({ text }: { readonly text: string }): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  if (text.length <= LONG_TEXT_CHARS) {
    return <span className={styles.paramVal}>{text}</span>;
  }
  return (
    <span className={styles.paramValWrap}>
      <span
        className={[
          styles.paramVal,
          styles.clamp,
          expanded ? styles.expanded : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {text}
      </span>
      <button
        type="button"
        className={styles.toggle}
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? "收起" : "展开全文"}
      </button>
    </span>
  );
}

/** 单个字段：基本值渲染为行（带 tone 色块 + diff gutter），嵌套对象/数组渲染为子区块。 */
function FieldRow({
  field,
  value,
  tone,
}: {
  readonly field: string;
  readonly value: JsonValue;
  readonly tone: ParameterTone;
}): JSX.Element {
  const label = paramKeyLabel(field) ?? field;
  // 基本值数组（如 aliases）行内展示：标签 + 顿号连接，而非子区块。
  if (Array.isArray(value) && value.every(isPrimitive)) {
    const joined =
      value.length === 0
        ? "空"
        : value.map((item) => primitiveText(item, field)).join("、");
    return (
      <div
        className={[styles.paramRow, toneClass(tone)]
          .filter(Boolean)
          .join(" ")}
      >
        {tone === undefined ? null : (
          <span className={styles.paramGutter}>{operationGlyph(tone)}</span>
        )}
        <span className={styles.paramTag}>{label}</span>
        <span className={styles.paramVal}>{joined}</span>
      </div>
    );
  }
  if (typeof value === "string") {
    return (
      <div
        className={[styles.paramRow, toneClass(tone)]
          .filter(Boolean)
          .join(" ")}
      >
        {tone === undefined ? null : (
          <span className={styles.paramGutter}>{operationGlyph(tone)}</span>
        )}
        <span className={styles.paramTag}>{label}</span>
        <LongText text={primitiveText(value, field)} />
      </div>
    );
  }
  if (isPrimitive(value)) {
    return (
      <div
        className={[styles.paramRow, toneClass(tone)]
          .filter(Boolean)
          .join(" ")}
      >
        {tone === undefined ? null : (
          <span className={styles.paramGutter}>{operationGlyph(tone)}</span>
        )}
        <span className={styles.paramTag}>{label}</span>
        <span className={styles.paramVal}>{primitiveText(value)}</span>
      </div>
    );
  }
  return (
    <div className={styles.paramSubBlock}>
      <div className={styles.paramSub}>{label}</div>
      <ParamFields value={value} field={field} tone={tone} />
    </div>
  );
}

/** 对象逐字段渲染（按 PARAM_FIELD_RANK 稳定排序、跳过隐藏字段）。 */
function ParamObject({
  obj,
  tone,
}: {
  readonly obj: JsonObject;
  readonly tone: ParameterTone;
}): JSX.Element {
  const entries = Object.entries(obj)
    .filter(([field]) => !isParamFieldHidden(field))
    .sort(([left], [right]) => paramFieldRank(left) - paramFieldRank(right));
  return (
    <div className={styles.params}>
      {entries.map(([field, fieldValue]) => (
        <FieldRow key={field} field={field} value={fieldValue} tone={tone} />
      ))}
    </div>
  );
}

/** 数组或对象的递归容器：基本值数组顿号连接，对象数组逐项子区块。 */
function ParamFields({
  value,
  field,
  tone,
}: {
  readonly value: JsonObject | JsonValue[];
  readonly field?: string;
  readonly tone: ParameterTone;
}): JSX.Element {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return (
        <div
          className={[styles.paramRow, toneClass(tone)]
            .filter(Boolean)
            .join(" ")}
        >
          {tone === undefined ? null : (
            <span className={styles.paramGutter}>{operationGlyph(tone)}</span>
          )}
          <span className={styles.paramVal}>空</span>
        </div>
      );
    }
    if (value.every(isPrimitive)) {
      return (
        <div
          className={[styles.paramRow, toneClass(tone)]
            .filter(Boolean)
            .join(" ")}
        >
          {tone === undefined ? null : (
            <span className={styles.paramGutter}>{operationGlyph(tone)}</span>
          )}
          <span className={styles.paramVal}>
            {value.map((item) => primitiveText(item, field)).join("、")}
          </span>
        </div>
      );
    }
    return (
      <div className={styles.paramItems}>
        {value.map((item, index) => (
          <div key={index} className={styles.paramItem}>
            <div className={styles.paramItemHead}>第 {index + 1} 项</div>
            {isJsonObject(item) ? (
              <ParamObject obj={item} tone={tone} />
            ) : Array.isArray(item) ? (
              <ParamFields value={item} field={field} tone={tone} />
            ) : (
              <div className={styles.paramVal}>{primitiveText(item, field)}</div>
            )}
          </div>
        ))}
      </div>
    );
  }
  return <ParamObject obj={value} tone={tone} />;
}

export interface ParameterViewProps {
  /** 待渲染的工具参数（JsonValue）。Tool arguments to render. */
  readonly value: JsonValue;
  /** 变更类型（方案 E diff 色块），行级左色条 + 底色 + diff 符号。 */
  readonly tone?: "add" | "edit" | "delete";
}

export function ParameterView({ value, tone }: ParameterViewProps): JSX.Element {
  if (isJsonObject(value) || Array.isArray(value)) {
    return <ParamFields value={value} tone={tone} />;
  }
  return (
    <div
      className={[styles.paramRow, toneClass(tone)]
        .filter(Boolean)
        .join(" ")}
    >
      {tone === undefined ? null : (
        <span className={styles.paramGutter}>{operationGlyph(tone)}</span>
      )}
      <span className={styles.paramVal}>{primitiveText(value)}</span>
    </div>
  );
}
