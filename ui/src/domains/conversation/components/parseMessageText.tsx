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
