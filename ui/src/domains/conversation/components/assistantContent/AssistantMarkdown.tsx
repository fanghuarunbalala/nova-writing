/**
 * Assistant 正文 Markdown 渲染器。
 * Renders assistant prose as Markdown with entity-reference chips.
 *
 * 标准 Markdown（粗体/列表/标题/GFM 表格）由 react-markdown + remark-gfm 渲染；
 * cc:// 引用链接（extractReferenceTags 生成）拦截为可点击的 MessageReferenceChip。
 * ```novel fenced code block 切出交给 NovelDraftPanel（正文草稿面板），
 * 与聊天注释视觉分离；流式期间最后一个正文块末尾显示闪烁光标。
 * memo 包裹：text 原值比较，历史消息零重解析（markdown 全管道是最大单项成本）。
 */
import { memo } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ToastKind } from "../../../../shared/state/ToastStore.js";
import {
  MessageReferenceChip,
  type MessageReference,
  type ResolvedReference,
} from "../MessageReference.js";
import { extractReferenceTags } from "./extractReferenceTags.js";
import { NovelDraftPanel } from "./NovelDraftPanel.js";
import styles from "./assistantMarkdown.module.css";

export interface AssistantMarkdownProps {
  readonly text: string;
  readonly onReferenceClick?: (reference: MessageReference) => void;
  /** 解析引用档案（名字/是否已建档）；自闭合引用与 missing 态依赖它。 */
  readonly resolveReference?: (reference: MessageReference) => ResolvedReference | undefined;
  /** 流式进行中：最后一个 ```novel 正文块末尾显示闪烁光标。 */
  readonly streaming?: boolean;
  /** 正文复制结果提示（shell 层 ToastHost）。 */
  readonly onNotify?: (kind: ToastKind, text: string) => void;
}

const REFERENCE_PREFIX = "cc://";

/** ```novel fenced block（小说正文草稿）；正文按空行分段、段内换行保留。 */
const NOVEL_FENCE_RE = /```novel\s*\n?([\s\S]*?)```/g;

interface MarkdownSegment {
  readonly kind: "md" | "novel";
  readonly content: string;
}

/** 把 ```novel 块切出为独立段：块间与首尾的普通 Markdown 归入 md 段。 */
function splitNovelSegments(text: string): MarkdownSegment[] {
  const segments: MarkdownSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(NOVEL_FENCE_RE)) {
    const index = match.index ?? 0;
    if (index > last) {
      segments.push({ kind: "md", content: text.slice(last, index) });
    }
    segments.push({ kind: "novel", content: match[1] ?? "" });
    last = index + match[0].length;
  }
  if (last < text.length) {
    segments.push({ kind: "md", content: text.slice(last) });
  }
  return segments;
}

export const AssistantMarkdown = memo(function AssistantMarkdown({
  text,
  onReferenceClick,
  resolveReference,
  streaming = false,
  onNotify,
}: AssistantMarkdownProps) {
  const content = extractReferenceTags(text);
  const segments = splitNovelSegments(content);
  const lastNovelIndex = segments.reduce(
    (last, segment, index) => (segment.kind === "novel" ? index : last),
    -1,
  );

  return (
    <div className={styles.markdown}>
      {segments.map((segment, index) => {
        if (segment.kind === "novel") {
          // 流式初期 ```novel 刚打开、正文为空时也渲染（kicker + 光标即时反馈）；
          // 完成后空块直接丢弃。
          if (segment.content.trim() === "" && !streaming) return null;
          return (
            <NovelDraftPanel
              key={index}
              content={segment.content}
              streaming={streaming && index === lastNovelIndex}
              onNotify={onNotify}
            />
          );
        }
        if (segment.content.trim() === "") return null;
        // 流式期间的最后一个 md 段末尾挂闪烁光标（与 novel 草稿面板同一动效语言）
        const streamingTail = streaming && index === segments.length - 1;
        return (
          <div key={index}>
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
                      const resolved = resolveReference?.(reference);
                      return (
                        <MessageReferenceChip
                          reference={reference}
                          onClick={onReferenceClick}
                          resolved={resolved}
                        />
                      );
                    }
                  }
                  return <a href={href}>{children}</a>;
                },
              }}
            >
              {segment.content}
            </ReactMarkdown>
            {streamingTail ? (
              <span className={styles.streamingCursor} aria-hidden="true" />
            ) : null}
          </div>
        );
      })}
    </div>
  );
});

function parseReferenceHref(href: string): MessageReference | null {
  const rest = href.slice(REFERENCE_PREFIX.length);
  const kindEnd = rest.indexOf("/");
  if (kindEnd < 0) return null;
  const kind = rest.slice(0, kindEnd);
  if (
    kind !== "character" &&
    kind !== "location" &&
    kind !== "outline" &&
    kind !== "paragraph" &&
    kind !== "chapter"
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
  return Object.freeze({
    refKind: kind as MessageReference["refKind"],
    id,
    ...(label !== "" ? { label } : {}),
  });
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
