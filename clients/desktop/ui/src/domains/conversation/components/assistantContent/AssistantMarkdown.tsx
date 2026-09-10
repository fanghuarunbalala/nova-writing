/**
 * Assistant 正文 Markdown 渲染器。
 * Renders assistant prose as Markdown with entity-reference chips.
 *
 * 标准 Markdown（粗体/列表/标题/GFM 表格）由 react-markdown + remark-gfm 渲染；
 * cc:// 引用链接（extractReferenceTags 生成）拦截为可点击的 MessageReferenceChip。
 * ```novel fenced code block 切出交给 NovelDraftPanel（正文草稿面板），
 * 与聊天注释视觉分离；流式期间最后一个正文块末尾显示闪烁光标。
 * memo 包裹：text 原值比较，历史消息零重解析（markdown 全管道是最大单项成本）。
 *
 * 流式前缀封存（gui-performance-2 功能点四）：streaming 时最后一个 md 段按段落
 * 边界拆「稳定前缀 + 活动尾段」——前缀经 MarkdownBlock memo（content 原值比较）
 * 跳过 ReactMarkdown 重解析，每次发布的解析成本 O(尾段) 而非 O(全文)。
 * components/urlTransform 经 useMemo 每实例一次（稳定 <a> 元素类型，避免重挂载）。
 */
import { Fragment, memo, useMemo, useRef, useState } from "react";
import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
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

/** remark 插件（模块常量：稳定引用，避免每次 render 重建数组） */
const REMARK_PLUGINS = [remarkGfm];

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

/**
 * 流式封存点：最后一个段落边界（\n\n）位置；无安全边界返回 -1。
 * 安全条件（逐个候选回退）：前缀无悬空标签开标记（'<' 后无 '>'，防拆开成对引用标签）、
 * 尾段 ``` 栅栏配对（防拆开未闭合的 fenced block）。
 */
function findSealBoundary(text: string): number {
  let idx = text.lastIndexOf("\n\n");
  while (idx > 0) {
    const prefix = text.slice(0, idx);
    const tail = text.slice(idx + 2);
    const lastLt = prefix.lastIndexOf("<");
    const danglingOpener = lastLt >= 0 && prefix.indexOf(">", lastLt) < 0;
    const fences = (tail.match(/```/g) ?? []).length;
    if (!danglingOpener && fences % 2 === 0) return idx;
    idx = text.lastIndexOf("\n\n", idx - 1);
  }
  return -1;
}

/** 单个 md 段渲染（memo：content 原值比较，封存前缀零重解析） */
const MarkdownBlock = memo(function MarkdownBlock({
  content,
  components,
  urlTransform,
}: {
  readonly content: string;
  readonly components: Components;
  readonly urlTransform: (url: string) => string;
}) {
  return (
    <ReactMarkdown remarkPlugins={REMARK_PLUGINS} urlTransform={urlTransform} components={components}>
      {content}
    </ReactMarkdown>
  );
});

/** 历史正文草稿面板（memo：content/streaming 相等即跳过；onNotify 仅影响 toast 展示） */
const MemoNovelDraftPanel = memo(
  NovelDraftPanel,
  (prev, next) => prev.content === next.content && prev.streaming === next.streaming,
);

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

  // 稳定渲染参数（每实例一次）：a 渲染器经 ref 读最新回调——类型引用稳定，
  // chip 点击/解析行为跟随本次 props（gui-performance-2 功能点四）
  const handlersRef = useRef({ onReferenceClick, resolveReference, onNotify });
  handlersRef.current = { onReferenceClick, resolveReference, onNotify };
  const components = useMemo<Components>(() => {
    // 复制按钮（useMemo 内定义一次 → 组件身份稳定；点击时读 handlersRef 最新 onNotify）
    const CopyCodeButton = ({ code }: { readonly code: string }) => {
      const [copied, setCopied] = useState(false);
      return (
        <button
          type="button"
          className={styles.copyBtn}
          onClick={() => {
            const notify = handlersRef.current.onNotify;
            if (navigator.clipboard === undefined) {
              notify?.("danger", "剪贴板不可用，请手动选择复制");
              return;
            }
            void navigator.clipboard
              .writeText(code)
              .then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
                notify?.("success", "代码已复制");
              })
              .catch(() => notify?.("danger", "复制失败，请手动选择复制"));
          }}
        >
          {copied ? "已复制" : "复制"}
        </button>
      );
    };
    return {
      a: ({ href, children }) => {
        if (typeof href === "string" && href.startsWith(REFERENCE_PREFIX)) {
          const reference = parseReferenceHref(href);
          if (reference !== null) {
            const { onReferenceClick: onClick, resolveReference: resolve } = handlersRef.current;
            const resolved = resolve?.(reference);
            return (
              <MessageReferenceChip reference={reference} onClick={onClick} resolved={resolved} />
            );
          }
        }
        return <a href={href}>{children}</a>;
      },
      // 代码块（demo .codeBlock）：语言标签头 + 复制按钮 + 等宽体（```novel 已在
      // 上游 splitNovelSegments 切出，此处只处理普通 fenced code）
      pre: ({ children }) => {
        const child = Array.isArray(children) ? children[0] : children;
        const className =
          typeof child === "object" && child !== null && "props" in child
            ? String((child as { props?: { className?: string } }).props?.className ?? "")
            : "";
        const language = /language-([\w-]+)/.exec(className)?.[1];
        const raw =
          typeof child === "object" && child !== null && "props" in child
            ? (child as { props?: { children?: unknown } }).props?.children
            : undefined;
        const code = typeof raw === "string" ? raw : "";
        return (
          <div className={styles.codeBlock}>
            <div className={styles.codeHead}>
              <span className={styles.codeHeadDot} aria-hidden="true" />
              {language === undefined ? "code" : language}
              <CopyCodeButton code={code} />
            </div>
            <pre>{children}</pre>
          </div>
        );
      },
      // 图片占位（demo .mdImgPh）：不加载外链（聊天正文防外链追踪/泄漏），
      // alt 作为占位文案与题注
      img: ({ alt }) => (
        <span className={styles.imageWrap}>
          <span className={styles.imagePlaceholder} role="img" aria-label={alt ?? "图片"}>
            {alt === undefined || alt === "" ? "图片（占位）" : `${alt}（占位图）`}
          </span>
          {alt !== undefined && alt !== "" ? (
            <span className={styles.imageCaption}>{alt}</span>
          ) : null}
        </span>
      ),
    };
  }, []);
  const urlTransform = useMemo(
    () => (url: string) =>
      url.startsWith(REFERENCE_PREFIX) ? url : defaultUrlTransform(url),
    [],
  );

  return (
    <div className={styles.markdown}>
      {segments.map((segment, index) => {
        if (segment.kind === "novel") {
          // 流式初期 ```novel 刚打开、正文为空时也渲染（kicker + 光标即时反馈）；
          // 完成后空块直接丢弃。
          if (segment.content.trim() === "" && !streaming) return null;
          return (
            <MemoNovelDraftPanel
              key={index}
              content={segment.content}
              streaming={streaming && index === lastNovelIndex}
              onNotify={onNotify}
            />
          );
        }
        if (segment.content.trim() === "") return null;
        // 流式封存：最后一个 md 段拆稳定前缀（memo 命中）+ 活动尾段（每次解析）；
        // 尾段后挂闪烁光标（与 novel 草稿面板同一动效语言）
        if (streaming && index === segments.length - 1) {
          const boundary = findSealBoundary(segment.content);
          if (boundary > 0) {
            const prefix = segment.content.slice(0, boundary);
            const tail = segment.content.slice(boundary + 2);
            return (
              <Fragment key={index}>
                {prefix.trim() !== "" && (
                  <MarkdownBlock content={prefix} components={components} urlTransform={urlTransform} />
                )}
                {tail.trim() !== "" && (
                  <MarkdownBlock content={tail} components={components} urlTransform={urlTransform} />
                )}
                <span className={styles.streamingCursor} aria-hidden="true" />
              </Fragment>
            );
          }
          return (
            <Fragment key={index}>
              <MarkdownBlock
                content={segment.content}
                components={components}
                urlTransform={urlTransform}
              />
              <span className={styles.streamingCursor} aria-hidden="true" />
            </Fragment>
          );
        }
        return (
          <MarkdownBlock
            key={index}
            content={segment.content}
            components={components}
            urlTransform={urlTransform}
          />
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
