/**
 * Assistant 正文 Markdown 渲染器。
 * Renders assistant prose as Markdown with entity-reference chips.
 *
 * 标准 Markdown（粗体/列表/标题/GFM 表格）由 react-markdown + remark-gfm 渲染；
 * cc:// 引用链接（extractReferenceTags 生成）拦截为可点击的 MessageReferenceChip。
 */
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  MessageReferenceChip,
  type MessageReference,
} from "../MessageReference.js";
import { extractReferenceTags } from "./extractReferenceTags.js";
import styles from "./assistantMarkdown.module.css";

export interface AssistantMarkdownProps {
  readonly text: string;
  readonly onReferenceClick?: (reference: MessageReference) => void;
}

const REFERENCE_PREFIX = "cc://";

export function AssistantMarkdown({
  text,
  onReferenceClick,
}: AssistantMarkdownProps) {
  const content = extractReferenceTags(text);
  return (
    <div className={styles.markdown}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) =>
          url.startsWith(REFERENCE_PREFIX) ? url : defaultUrlTransform(url)
        }
        components={{
          a: ({ href, children }) => {
            if (typeof href === "string" && href.startsWith(REFERENCE_PREFIX)) {
              const reference = parseReferenceHref(href);
              if (reference !== null) {
                return (
                  <MessageReferenceChip
                    reference={reference}
                    onClick={onReferenceClick}
                  />
                );
              }
            }
            return <a href={href}>{children}</a>;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function parseReferenceHref(href: string): MessageReference | null {
  const rest = href.slice(REFERENCE_PREFIX.length);
  const kindEnd = rest.indexOf("/");
  if (kindEnd < 0) return null;
  const kind = rest.slice(0, kindEnd);
  if (
    kind !== "character" &&
    kind !== "location" &&
    kind !== "outline" &&
    kind !== "paragraph"
  ) {
    return null;
  }
  const remainder = rest.slice(kindEnd + 1);
  const idEnd = remainder.indexOf("/");
  const id = idEnd < 0 ? remainder : remainder.slice(0, idEnd);
  const label =
    idEnd < 0
      ? id
      : safeDecode(remainder.slice(idEnd + 1));
  return Object.freeze({ refKind: kind, id, label });
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
