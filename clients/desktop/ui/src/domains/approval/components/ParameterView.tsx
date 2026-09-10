/**
 * ParameterView
 *
 * 审批「变更后/写入内容/删除参数」段的参数渲染（对齐 demo .apParam dl 网格）：
 * 对象逐字段「中文标签 + 值」，基本值数组顿号连接，对象数组（values 等）直接
 * 平铺字段省略「变更项 / 第 N 项」包装，项间用细分割线；已知枚举值翻译为中文。
 * id 引用字段（storyUnitId/characterId 等）经 id→名称映射渲染为名称（未命中
 * 回退原值）；paragraphIds 按段落数摘要；leaf（场景计划）改走 LeafPlanCard
 * 专用卡片，不平铺。长文本默认 4 行截断，可「展开全文」。
 * markdown 文档（Write .md 文件的 content 全文）改走 AssistantMarkdown 渲染，
 * 不截断——审批需通读全文。操作类型由卡片「变更后」段的色带 band 表达。
 */
import { Fragment, createContext, useContext, useState, type JSX } from "react";
import type { JsonObject, JsonValue } from "../jsonTypes.js";
import {
  isIdReferenceField,
  isParamFieldHidden,
  paramFieldRank,
  paramKeyLabel,
  paramValueLabel,
  PARAGRAPH_IDS_FIELD,
} from "../paramLabels.js";
import { AssistantMarkdown } from "../../conversation/components/assistantContent/AssistantMarkdown.js";
import { coerceLeafPlan, LeafPlanCard } from "../../novel/outline/components/LeafPlanCard.js";
import styles from "./ParameterView.module.css";

const LONG_TEXT_CHARS = 120;

/** id → 名称映射（ParameterView 根注入，FieldRow 逐值替换）。 */
const IdNamesContext = createContext<ReadonlyMap<string, string> | undefined>(undefined);

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

/** id 引用值 → 名称（未命中不回退内部 id，显示占位）；非引用字段保持枚举翻译。 */
function refText(
  field: string,
  value: string,
  idNames: ReadonlyMap<string, string> | undefined,
): string {
  if (isIdReferenceField(field)) return idNames?.get(value) ?? "未知实体";
  return paramValueLabel(field, value) ?? value;
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
  const idNames = useContext(IdNamesContext);
  // leaf（场景计划）：形状合规改走专用卡片，不再平铺网格。
  if (field === "leaf" && isJsonObject(value)) {
    const leaf = coerceLeafPlan(value);
    if (leaf !== undefined) {
      return <LeafPlanCard leaf={leaf} characterNames={idNames} locationNames={idNames} />;
    }
  }
  const label = paramKeyLabel(field) ?? field;
  // 基本值数组（如 aliases）行内展示：标签 + 顿号连接，而非子区块。
  if (Array.isArray(value) && value.every(isPrimitive)) {
    // 段落 id 列表：按数量摘要（段落 id 对作者无意义）。
    if (field === PARAGRAPH_IDS_FIELD) {
      return (
        <div className={styles.paramRow}>
          <span className={styles.paramTag}>{label}</span>
          <span className={styles.paramVal}>
            {value.length === 0 ? "空" : `正文 · ${value.length} 段`}
          </span>
        </div>
      );
    }
    const joined =
      value.length === 0
        ? "空"
        : value
            .map((item) =>
              typeof item === "string"
                ? refText(field, item, idNames)
                : primitiveText(item, field),
            )
            .join("、");
    return (
      <div className={styles.paramRow}>
        <span className={styles.paramTag}>{label}</span>
        <span className={styles.paramVal}>{joined}</span>
      </div>
    );
  }
  // 对象数组（如 values）直接平铺，省略变更项/第 N 项包装。
  if (Array.isArray(value) && value.length > 0 && value.every(isJsonObject)) {
    return <ParamObjectArray items={value} />;
  }
  if (typeof value === "string") {
    return (
      <div className={styles.paramRow}>
        <span className={styles.paramTag}>{label}</span>
        <LongText
          text={
            isIdReferenceField(field)
              ? refText(field, value, idNames)
              : primitiveText(value, field)
          }
        />
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
  const idNames = useContext(IdNamesContext);
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
            {value
              .map((item) =>
                typeof item === "string" && field !== undefined
                  ? refText(field, item, idNames)
                  : primitiveText(item, field),
              )
              .join("、")}
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

/** markdown 文档参数：其余字段照常网格行，content 全文走 markdown 渲染（限高滚动）。 */
function MarkdownDocFields({
  obj,
  content,
}: {
  readonly obj: JsonObject;
  readonly content: string;
}): JSX.Element {
  const rest = Object.fromEntries(
    Object.entries(obj).filter(([field]) => field !== "content"),
  );
  return (
    <div className={styles.params}>
      {Object.keys(rest).length > 0 ? <ParamObject obj={rest} /> : null}
      <div className={styles.paramRow}>
        <span className={styles.paramTag}>{paramKeyLabel("content") ?? "content"}</span>
        <div className={styles.mdContent}>
          <AssistantMarkdown text={content} />
        </div>
      </div>
    </div>
  );
}

export interface ParameterViewProps {
  /** 待渲染的工具参数（JsonValue）。Tool arguments to render. */
  readonly value: JsonValue;
  /** content 为 markdown 文档全文（Write .md 文件）：改走 AssistantMarkdown 渲染。 */
  readonly contentAsMarkdown?: boolean;
  /** id → 实体名称映射（id 引用字段与 leaf chips 渲染为名称；缺省回退原值）。 */
  readonly idNames?: ReadonlyMap<string, string>;
}

export function ParameterView({
  value,
  contentAsMarkdown = false,
  idNames,
}: ParameterViewProps): JSX.Element {
  if (contentAsMarkdown && isJsonObject(value) && typeof value.content === "string") {
    return <MarkdownDocFields obj={value} content={value.content} />;
  }
  const body =
    isJsonObject(value) || Array.isArray(value) ? (
      <ParamFields value={value} />
    ) : (
      <div className={styles.paramRow}>
        <span className={styles.paramVal}>{primitiveText(value)}</span>
      </div>
    );
  return <IdNamesContext.Provider value={idNames}>{body}</IdNamesContext.Provider>;
}
