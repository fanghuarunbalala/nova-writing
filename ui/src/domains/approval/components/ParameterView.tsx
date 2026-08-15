/**
 * ParameterView
 *
 * 审批「变更后/写入内容/删除参数」段的参数渲染（对齐 demo .apParam dl 网格）：
 * 对象逐字段「中文标签 + 值」，基本值数组顿号连接，对象数组（values、
 * leaf.characters 等）直接平铺字段省略「变更项 / 第 N 项」包装，项间用细分割线；
 * 已知枚举值翻译为中文。长文本默认 4 行截断，可「展开全文」。
 * 操作类型由卡片「变更后」段的色带 band 表达，参数行本身不再着色。
 *
 * Recursively renders tool arguments as Chinese-labelled rows matching the
 * demo .apParam dl grid; primitive arrays join with 、; object arrays flatten
 * their fields directly (no 变更项 / 第 N 项 wrappers), separated by thin
 * dividers; known enum values are translated. Long text is clamped to 4 lines
 * with an expand toggle.
 */
import { Fragment, useState, type JSX } from "react";
import type { JsonObject, JsonValue } from "../jsonTypes.js";
import {
  isParamFieldHidden,
  paramFieldRank,
  paramKeyLabel,
  paramValueLabel,
} from "../paramLabels.js";
import styles from "./ParameterView.module.css";

const LONG_TEXT_CHARS = 120;

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

/** 对象数组：直接平铺各项字段，省略「变更项 / 第 N 项」等无效包装，项间用细分割线。 */
function ParamObjectArray({
  items,
}: {
  readonly items: readonly JsonObject[];
}): JSX.Element {
  return (
    <div className={styles.paramItems}>
      {items.map((item, index) => (
        <Fragment key={index}>
          {index > 0 ? <div className={styles.paramItemDivider} /> : null}
          <ParamObject obj={item} />
        </Fragment>
      ))}
    </div>
  );
}

/** 单个字段：基本值渲染为行（标签 + 值网格），嵌套对象/数组递归。 */
function FieldRow({
  field,
  value,
}: {
  readonly field: string;
  readonly value: JsonValue;
}): JSX.Element {
  const label = paramKeyLabel(field) ?? field;
  // 基本值数组（如 aliases）行内展示：标签 + 顿号连接，而非子区块。
  if (Array.isArray(value) && value.every(isPrimitive)) {
    const joined =
      value.length === 0
        ? "空"
        : value.map((item) => primitiveText(item, field)).join("、");
    return (
      <div className={styles.paramRow}>
        <span className={styles.paramTag}>{label}</span>
        <span className={styles.paramVal}>{joined}</span>
      </div>
    );
  }
  // 对象数组（如 values、leaf.characters）直接平铺，省略变更项/第 N 项包装。
  if (Array.isArray(value) && value.length > 0 && value.every(isJsonObject)) {
    return <ParamObjectArray items={value} />;
  }
  if (typeof value === "string") {
    return (
      <div className={styles.paramRow}>
        <span className={styles.paramTag}>{label}</span>
        <LongText text={primitiveText(value, field)} />
      </div>
    );
  }
  if (isPrimitive(value)) {
    return (
      <div className={styles.paramRow}>
        <span className={styles.paramTag}>{label}</span>
        <span className={styles.paramVal}>{primitiveText(value)}</span>
      </div>
    );
  }
  // Edit 工具 `{ id, value }` 包装：展开 value 内层字段，去掉「变更值」包装。
  if (field === "value" && isJsonObject(value)) {
    return <ParamObject obj={value} />;
  }
  return (
    <div className={styles.paramSubBlock}>
      <div className={styles.paramSub}>{label}</div>
      <ParamFields value={value} field={field} />
    </div>
  );
}

/** 对象逐字段渲染（按 PARAM_FIELD_RANK 稳定排序、跳过隐藏字段）。 */
function ParamObject({ obj }: { readonly obj: JsonObject }): JSX.Element {
  const entries = Object.entries(obj)
    .filter(([field]) => !isParamFieldHidden(field))
    .sort(([left], [right]) => paramFieldRank(left) - paramFieldRank(right));
  return (
    <div className={styles.params}>
      {entries.map(([field, fieldValue]) => (
        <FieldRow key={field} field={field} value={fieldValue} />
      ))}
    </div>
  );
}

/** 数组或对象的递归容器：基本值数组顿号连接，对象数组逐项子区块。 */
function ParamFields({
  value,
  field,
}: {
  readonly value: JsonObject | JsonValue[];
  readonly field?: string;
}): JSX.Element {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return (
        <div className={styles.paramRow}>
          <span className={styles.paramVal}>空</span>
        </div>
      );
    }
    if (value.every(isPrimitive)) {
      return (
        <div className={styles.paramRow}>
          <span className={styles.paramVal}>
            {value.map((item) => primitiveText(item, field)).join("、")}
          </span>
        </div>
      );
    }
    return (
      <div className={styles.paramItems}>
        {value.map((item, index) => (
          <Fragment key={index}>
            {index > 0 ? <div className={styles.paramItemDivider} /> : null}
            {isJsonObject(item) ? (
              <ParamObject obj={item} />
            ) : Array.isArray(item) ? (
              <ParamFields value={item} field={field} />
            ) : (
              <div className={styles.paramVal}>{primitiveText(item, field)}</div>
            )}
          </Fragment>
        ))}
      </div>
    );
  }
  return <ParamObject obj={value} />;
}

export interface ParameterViewProps {
  /** 待渲染的工具参数（JsonValue）。Tool arguments to render. */
  readonly value: JsonValue;
}

export function ParameterView({ value }: ParameterViewProps): JSX.Element {
  if (isJsonObject(value) || Array.isArray(value)) {
    return <ParamFields value={value} />;
  }
  return (
    <div className={styles.paramRow}>
      <span className={styles.paramVal}>{primitiveText(value)}</span>
    </div>
  );
}
