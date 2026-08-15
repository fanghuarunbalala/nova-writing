/**
 * ApprovalEntityView
 *
 * 渲染一个解析出的审批目标实体的「当前内容」视图（demo .apCur 区）：
 * 目标名 + 结构上下文（大纲树 / 卷章列表 / 相邻段落）+ 当前值字段行
 * （edit/delete/ctx 取 old，add 字段无当前值跳过）+ 「写作方案」（leaf）子块。
 * 新值不再在此展示——由卡片「变更后」段的参数行承载（demo 两段式）。
 *
 * Renders one resolved approval target as its CURRENT content (demo .apCur):
 * name, structural context (outline tree / volume-chapter list / neighboring
 * paragraphs), current-value field rows, and the "写作方案" (leaf) sub-block.
 * New values live in the card's "变更后" parameter section instead.
 */
import type { JSX } from "react";
import type {
  ApprovalContextNode,
  ApprovalFieldLine,
  ApprovalParagraphLine,
  ResolvedEntityContent,
} from "../approvalEntityResolver.js";
import styles from "./ApprovalEntityView.module.css";

const STATUS_LABEL: Readonly<Record<string, string>> = {
  pending: "未开始",
  "in-progress": "进行中",
  completed: "已完成",
  blocked: "阻塞",
  abandoned: "已废弃",
};

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

/** 树/列表节点（当前内容视图：目标节点 warn 高亮；新增节点无当前态，跳过）。 */
function TreeNode({ node }: { readonly node: ApprovalContextNode }): JSX.Element | null {
  if (node.state === "add") return null;
  return (
    <>
      <div className={[styles.node, node.state === "current" ? styles.current : ""]
        .filter(Boolean)
        .join(" ")}>
        <span className={styles.nm}>{node.label}</span>
        {node.scope !== undefined ? (
          <span className={styles.sc}>{node.scope}</span>
        ) : null}
        {node.status !== undefined ? (
          <span className={styles.st}>
            <i aria-hidden="true" />
            {STATUS_LABEL[node.status] ?? node.status}
          </span>
        ) : null}
      </div>
      {node.children !== undefined && node.children.length > 0 ? (
        <div className={styles.children}>
          {node.children.map((child) => (
            <TreeNode key={child.id} node={child} />
          ))}
        </div>
      ) : null}
    </>
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

export interface ApprovalEntityViewProps {
  readonly content: ResolvedEntityContent;
}

export function ApprovalEntityView({
  content,
}: ApprovalEntityViewProps): JSX.Element {
  const context = content.context;
  return (
    <div className={styles.entity}>
      <div className={styles.name}>{content.name}</div>
      {context !== undefined ? (
        <div className={styles.tree}>
          {context.type === "list" && context.parent !== undefined ? (
            <div className={styles.parent}>{context.parent}</div>
          ) : null}
          {context.nodes.map((node) => (
            <TreeNode key={node.id} node={node} />
          ))}
        </div>
      ) : null}
      {content.fields.length > 0 ? (
        <div className={styles.fields}>
          {content.fields.map((line, index) => (
            <FieldLine key={`${line.field}-${index}`} line={line} />
          ))}
        </div>
      ) : null}
      {content.leaf !== undefined && content.leaf.length > 0 ? (
        <div className={styles.leaf}>
          <div className={styles.leafhead}>
            写作方案 <span className={styles.leafTag}>LEAF</span>
          </div>
          {content.leaf.map((line, index) => (
            <FieldLine key={`leaf-${line.field}-${index}`} line={line} />
          ))}
        </div>
      ) : null}
      {content.paragraphs !== undefined && content.paragraphs.length > 0 ? (
        <ParagraphLines lines={content.paragraphs} />
      ) : null}
    </div>
  );
}
