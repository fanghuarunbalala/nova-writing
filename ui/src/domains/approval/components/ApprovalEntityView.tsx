/**
 * ApprovalEntityView
 *
 * 渲染一个解析出的审批目标实体（v4 设计）：目标名 + 结构上下文（大纲树 /
 * 卷章列表 / 相邻段落）+ 字段 diff 行（红=旧/删除、绿=新/新增、灰=上下文）
 * + 「写作方案」（leaf）子块。层级用嵌套容器 + 竖向引导线 + 横向枝表达，
 * 变更节点色块高亮，diff 行挂在被改节点下。
 *
 * Renders one resolved approval target (v4): name, structural context (outline
 * tree / volume-chapter list / neighboring paragraphs), diff-field rows
 * (red=old/delete, green=new/add, gray=context), and the "写作方案" (leaf)
 * sub-block. Hierarchy uses nested containers with guide lines.
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

/** 单条 diff 行（编辑字段渲染为红旧+绿新两行）。 */
function FieldLine({ line }: { readonly line: ApprovalFieldLine }): JSX.Element {
  if (line.state === "edit") {
    return (
      <>
        <div className={[styles.dl, styles.old].join(" ")}>
          <span className={styles.g}>−</span>
          <span className={styles.fld}>{line.label}</span>
          <span className={styles.txt}>{line.old ?? "—"}</span>
        </div>
        <div className={[styles.dl, styles.new].join(" ")}>
          <span className={styles.g}>+</span>
          <span className={styles.fld}>{line.label}</span>
          <span className={styles.txt}>{line.new ?? "—"}</span>
        </div>
      </>
    );
  }
  const glyph = line.state === "add" ? "+" : line.state === "delete" ? "−" : "·";
  const value = line.state === "delete" ? line.old : line.new;
  const tone =
    line.state === "add"
      ? styles.add
      : line.state === "delete"
        ? styles.del
        : styles.ctx;
  return (
    <div className={[styles.dl, tone].filter(Boolean).join(" ")}>
      <span className={styles.g}>{glyph}</span>
      <span className={styles.fld}>{line.label}</span>
      <span className={styles.txt}>{value ?? "—"}</span>
    </div>
  );
}

/** 树/列表节点（嵌套容器 + 变更高亮）。 */
function TreeNode({
  node,
}: {
  readonly node: ApprovalContextNode;
}): JSX.Element {
  const tone =
    node.state === "current"
      ? styles.current
      : node.state === "add"
        ? styles.add
        : node.state === "delete"
          ? styles.del
          : "";
  return (
    <>
      <div className={[styles.node, tone].filter(Boolean).join(" ")}>
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

/** 相邻/章内段落原文。 */
function ParagraphLines({
  lines,
}: {
  readonly lines: readonly ApprovalParagraphLine[];
}): JSX.Element {
  return (
    <div className={styles.para}>
      {lines.map((line, index) => {
        const tone =
          line.state === "old"
            ? styles.old
            : line.state === "new"
              ? styles.new
              : styles.ctx;
        const glyph = line.state === "old" ? "−" : line.state === "new" ? "+" : "·";
        return (
          <div key={index} className={[styles.dl, tone].filter(Boolean).join(" ")}>
            <span className={styles.g}>{glyph}</span>
            <span className={styles.txt}>{line.text}</span>
          </div>
        );
      })}
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
            写作方案 <span className={styles.sc}>LEAF</span>
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
