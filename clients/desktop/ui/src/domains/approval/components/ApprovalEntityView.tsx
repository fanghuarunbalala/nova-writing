/**
 * ApprovalEntityView
 *
 * 渲染一个解析出的审批目标实体的「当前内容」视图（demo .apCur 区）：
 * 目标名 + 结构上下文面包屑（demo 极简形态：卷 › 章 › 单元 单行）+ 当前值
 * 字段行（edit/delete/ctx 取 old，add 字段无当前值跳过）+ 场景计划 leaf 卡
 * （LeafPlanCard，与「变更后」段同一形态）+ 相邻段落原文。
 * 新值不再在此展示——由卡片「变更后」段的参数行承载（demo 两段式）。
 */
import type { JSX } from "react";
import type {
  ApprovalFieldLine,
  ApprovalParagraphLine,
  ResolvedEntityContent,
} from "../approvalEntityResolver.js";
import { coerceLeafPlan, LeafPlanCard } from "../../novel/outline/components/LeafPlanCard.js";
import styles from "./ApprovalEntityView.module.css";

/** 单条字段行：当前值（edit/delete/ctx → old；add 无当前值不渲染）。 */
function FieldLine({ line }: { readonly line: ApprovalFieldLine }): JSX.Element | null {
  const value = line.old ?? (line.state === "ctx" ? line.new : undefined);
  if (value === undefined) return null;
  return (
    <div className={styles.row}>
      <span className={styles.fld}>{line.label}</span>
      <span className={styles.txt}>{value}</span>
    </div>
  );
}

/** 相邻/章内段落原文（当前内容：仅 old/ctx 行，宋体 muted）。 */
function ParagraphLines({
  lines,
}: {
  readonly lines: readonly ApprovalParagraphLine[];
}): JSX.Element {
  return (
    <div className={styles.para}>
      {lines
        .filter((line) => line.state !== "new")
        .map((line, index) => (
          <p key={index} className={styles.paraLine}>{line.text}</p>
        ))}
    </div>
  );
}

/** 结构上下文 → 单行面包屑（tree=祖先链；list=父 + 目标）。 */
function contextCrumb(
  context: NonNullable<ResolvedEntityContent["context"]>,
): string {
  const parts =
    context.type === "tree"
      ? context.nodes.map((node) => node.label)
      : [
          context.parent ?? "",
          ...context.nodes
            .filter((node) => node.state === "current")
            .map((node) => node.label),
        ];
  return parts.filter((part) => part !== "").join(" › ");
}

export interface ApprovalEntityViewProps {
  readonly content: ResolvedEntityContent;
  /** id → 实体名称映射（leaf chips 显示名称；缺省回退原值）。 */
  readonly idNames?: ReadonlyMap<string, string>;
}

export function ApprovalEntityView({
  content,
  idNames,
}: ApprovalEntityViewProps): JSX.Element {
  const crumb = content.context !== undefined ? contextCrumb(content.context) : "";
  const leaf = coerceLeafPlan(content.leaf);
  return (
    <div className={styles.entity}>
      <div className={styles.name}>{content.name}</div>
      {crumb !== "" ? <div className={styles.crumb}>{crumb}</div> : null}
      {content.fields.length > 0 ? (
        <div className={styles.fields}>
          {content.fields.map((line, index) => (
            <FieldLine key={`${line.field}-${index}`} line={line} />
          ))}
        </div>
      ) : null}
      {leaf !== undefined ? (
        <div className={styles.leafCard}>
          <LeafPlanCard leaf={leaf} characterNames={idNames} locationNames={idNames} />
        </div>
      ) : null}
      {content.paragraphs !== undefined && content.paragraphs.length > 0 ? (
        <ParagraphLines lines={content.paragraphs} />
      ) : null}
    </div>
  );
}
