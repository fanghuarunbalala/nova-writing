/**
 * parseMessageText
 *
 * 把用户消息文本中的内联标记（<character id="x">名</character> 等）
 * 解析为文本节点与 MessageReference chip 的混合渲染。
 */
import type { ReactNode } from "react";
import { MessageReferenceChip, type MessageReference } from "./MessageReference.js";

const INLINE_TAG_PATTERN = /<(character|location|outline)\s+id="([^"]+)">([^<]*)<\/\1>/g;

export function parseMessageText(
  text: string,
  onReferenceClick?: (reference: MessageReference) => void,
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
    const reference: MessageReference = {
      refKind,
      id: match[2],
      label: match[3] || match[2],
    };
    nodes.push(
      <MessageReferenceChip key={`ref-${key++}`} reference={reference} onClick={onReferenceClick} />,
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes;
}
