/**
 * parseMessageText
 *
 * 把用户消息文本中的内联标记（<character id="x">名</character> 等）
 * 解析为文本节点与 MessageReference chip 的混合渲染。
 */
import type { ReactNode } from "react";
import {
  MessageReferenceChip,
  type MessageReference,
  type ResolvedReference,
} from "./MessageReference.js";

const REF_KIND = "character|location|outline|chapter|paragraph";

/** 成对或自闭合引用标签；自闭合时 group 4 为空。 */
const INLINE_TAG_PATTERN = new RegExp(
  `<(${REF_KIND})\\s+id="([^"]+)"(?:\\s+name="([^"]*)")?\\s*(?:\\/>|>([^<]*)<\\/\\1>)`,
  "g",
);

/** 整行仅由引用标签构成（core 序列化格式：正文 + "\n" + 标签行…）。 */
const TAG_ONLY_LINE_PATTERN = new RegExp(
  `^(?:<(?:${REF_KIND})\\s+id="[^"]+"(?:\\s+name="[^"]*")?\\s*(?:\\/>|>(?:[^<]*)<\\/(?:${REF_KIND})>))+$`,
);

export interface SplitTrailingReferencesResult {
  /** 剥离尾部引用标签行后的正文（纯引用消息为空串） */
  readonly text: string;
  /** 尾部引用标签解析出的引用（保持原顺序） */
  readonly references: readonly MessageReference[];
}

/**
 * 剥离用户消息尾部的引用标签块（core 把 references 序列化为整行标签追加在
 * 正文后）：气泡把这些渲染为顶部 chips 行（对齐 demo .msgRefs），正文部分
 * 继续走 parseMessageText（正文中手写的内联标签仍按行内 chip 渲染）。
 */
export function splitTrailingReferences(text: string): SplitTrailingReferencesResult {
  const lines = text.split("\n");
  let cut = lines.length;
  while (cut > 0 && TAG_ONLY_LINE_PATTERN.test(lines[cut - 1] ?? "")) cut -= 1;
  if (cut === lines.length) return { text, references: [] };
  const tagBlock = lines.slice(cut).join("\n");
  const references: MessageReference[] = [];
  let match: RegExpExecArray | null;
  INLINE_TAG_PATTERN.lastIndex = 0;
  while ((match = INLINE_TAG_PATTERN.exec(tagBlock)) !== null) {
    const name = match[3];
    const inner = match[4];
    const label = name !== undefined && name !== "" ? name : (inner ?? "");
    references.push({
      refKind: match[1] as MessageReference["refKind"],
      id: match[2]!,
      ...(label !== "" ? { label } : {}),
    });
  }
  return { text: lines.slice(0, cut).join("\n").replace(/\n+$/, ""), references };
}

export function parseMessageText(
  text: string,
  onReferenceClick?: (reference: MessageReference) => void,
  resolveReference?: (reference: MessageReference) => ResolvedReference | undefined,
): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  INLINE_TAG_PATTERN.lastIndex = 0;
  while ((match = INLINE_TAG_PATTERN.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const refKind = match[1] as MessageReference["refKind"];
    const name = match[3];
    const inner = match[4];
    const label = name !== undefined && name !== "" ? name : (inner ?? "");
    const reference: MessageReference = {
      refKind,
      id: match[2]!,
      ...(label !== "" ? { label } : {}),
    };
    nodes.push(
      <MessageReferenceChip
        key={`ref-${key++}`}
        reference={reference}
        onClick={onReferenceClick}
        resolved={resolveReference?.(reference)}
      />,
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes;
}
