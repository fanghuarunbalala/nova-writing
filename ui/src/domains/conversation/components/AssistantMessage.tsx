/**
 * AssistantMessage
 *
 * 助手消息（原型 .msg.assistant）：无头像，head 只保留 approval-state 状态
 * 标签；正文 + 按 turn 分段的工具单行（每段 = 内容片段 + 工具行，
 * 见 docs/design/tool-call-embed-demo.html）+ 结构化卡片。
 * 卡片通过 ConversationCardRendererRegistry 渲染。
 * memo 包裹：历史消息（text/cards/segments 引用稳定）零重渲染、markdown 零重解析。
 */
import { memo, useEffect, useState } from "react";
import { createDefaultConversationCardRendererRegistry } from "../cards/defaultRenderers.js";
import type { ConversationCardRendererRegistry } from "../cards/ConversationCardRendererRegistry.js";
import type {
  ConversationCardDescriptor,
} from "../projection/ConversationCardDescriptor.js";
import type {
  AssistantSegment,
  ToolTraceView,
} from "../projection/ConversationTimelineItem.js";
import type { ReferenceResolver } from "../reference/ReferenceResolver.js";
import type { ToastKind } from "../../../shared/state/ToastStore.js";
import { AssistantMarkdown } from "./assistantContent/AssistantMarkdown.js";
import type { MessageReference } from "./MessageReference.js";
import styles from "./AssistantMessage.module.css";

/** 缺省卡片渲染注册表（模块级单例：避免每 render 重建 registry） */
const DEFAULT_CARD_RENDERERS = createDefaultConversationCardRendererRegistry();

/** 缺省空数组（冻结单例：memo 浅比较稳定引用） */
const EMPTY_CARDS: readonly ConversationCardDescriptor[] = Object.freeze([]);
const EMPTY_SEGMENTS: readonly AssistantSegment[] = Object.freeze([]);
const EMPTY_TOOLS: readonly ToolTraceView[] = Object.freeze([]);

export interface AssistantMessageProps {
  readonly sequence: number;
  /** 保留兼容调用方；v2 原型 head 只显示 approval-state，不再渲染。 */
  readonly agentLabel: string;
  /** 保留兼容调用方；v2 原型时间只在轮次分隔显示。 */
  readonly timestamp: number;
  /** 保留兼容调用方；v2 原型 head 不再显示 revision。 */
  readonly revision?: string;
  readonly failureDetail?: string;
  readonly text: string;
  readonly cards?: readonly ConversationCardDescriptor[];
  readonly streaming?: boolean;
  /** turn 分段：每段 = 内容片段 + 该请求的工具行（缺省空数组） */
  readonly segments?: readonly AssistantSegment[];
  readonly onReferenceClick?: (reference: MessageReference) => void;
  readonly onResolveReference?: ReferenceResolver;
  readonly cardRenderers?: ConversationCardRendererRegistry;
  readonly onCardAction?: (cardId: string, action: string, payload?: unknown) => void;
  /** 消息内操作提示（如正文复制结果）；上行到 shell ToastHost。 */
  readonly onNotify?: (kind: ToastKind, text: string) => void;
}

export const AssistantMessage = memo(function AssistantMessage({
  sequence,
  failureDetail,
  text,
  cards = EMPTY_CARDS,
  streaming = false,
  segments = EMPTY_SEGMENTS,
  onReferenceClick,
  onResolveReference,
  cardRenderers = DEFAULT_CARD_RENDERERS,
  onCardAction,
  onNotify,
}: AssistantMessageProps) {
  // live 流式：逐 turn 分段渲染（每段 = 内容 + 工具行，换行分隔，边界清晰、正文随流式增长无跳变）；
  // 轮收口后：收敛为最后一段（正文 = 最后一段内容片段，重放空段回退完整文本）
  const lastSegment = segments.length > 0 ? segments[segments.length - 1] : undefined;
  const lastText = lastSegment?.text ?? "";
  const bodyText = lastText.length > 0 ? lastText : text;
  const lastTools = lastSegment?.tools ?? EMPTY_TOOLS;
  const segmentedLive = streaming && segments.length > 0;
  return (
    <div className={styles.message} data-sequence={sequence}>
      <div className={styles.body}>
        {segmentedLive ? (
          segments.map((seg, i) => (
            <div key={i} className={styles.segment}>
              {seg.text !== "" ? (
                <div className={styles.text}>
                  <AssistantMarkdown
                    text={seg.text}
                    onReferenceClick={onReferenceClick}
                    resolveReference={onResolveReference}
                    streaming={i === segments.length - 1}
                    onNotify={onNotify}
                  />
                </div>
              ) : null}
              {seg.tools.length > 0 ? <ToolLine tools={seg.tools} /> : null}
            </div>
          ))
        ) : (
          <>
            <div className={styles.text}>
              <AssistantMarkdown
                text={bodyText}
                onReferenceClick={onReferenceClick}
                resolveReference={onResolveReference}
                streaming={streaming}
                onNotify={onNotify}
              />
            </div>
            {lastTools.length > 0 ? <ToolLine tools={lastTools} /> : null}
          </>
        )}
        {failureDetail !== undefined ? (
          <p className={styles.failureDetail}>{failureDetail}</p>
        ) : null}
        {cards.length > 0 ? (
          <div className={styles.cards}>
            {cards.map((card) => {
              const renderer = cardRenderers.get(card.kind);
              if (renderer === undefined) return null;
              return (
                <div key={card.id} className={styles.card}>
                  {renderer.render({
                    card,
                    onAction: (action, payload) => onCardAction?.(card.id, action, payload),
                  })}
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
});

/** 工具单行：一次请求的工具调用拼成一行（⏳ 动作+对象+中：内容 / ✓ 对象+动作+已完成：内容） */
function ToolLine({ tools }: { readonly tools: readonly ToolTraceView[] }) {
  return (
    <div className={styles.toolLine}>
      {tools.map((t) => {
        const action = t.preview?.action ?? "执行";
        const object = t.preview?.object ?? "工具";
        const content = t.preview?.title !== undefined ? `：${t.preview.title}` : "";
        if (t.outcome === undefined) {
          return (
            <span key={t.traceId} className={styles.toolRunning}>
              <span className={styles.spinner} />
              {action}
              {object}中{content}
              <LiveSeconds startedAt={t.startedAt} />
            </span>
          );
        }
        const dur = t.durationMs !== undefined ? ` ${(t.durationMs / 1000).toFixed(1)}s` : "";
        if (t.outcome === "failed") {
          return (
            <span key={t.traceId} className={styles.toolFailed}>
              ✗ {object}
              {action}失败{content}
              {dur}
            </span>
          );
        }
        return (
          <span key={t.traceId} className={styles.toolDone}>
            ✓ {object}
            {action}已完成{content}
            {dur}
          </span>
        );
      })}
    </div>
  );
}

/** 进行中工具实时秒数（1s 粒度跳动；startedAt 缺失时不渲染也不挂定时器） */
function LiveSeconds({ startedAt }: { readonly startedAt?: number }) {
  const active = startedAt !== undefined && !Number.isNaN(startedAt);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  if (!active) return null;
  const secs = Math.max(0, (now - startedAt!) / 1000);
  return <span className={styles.toolSec}>{secs.toFixed(1)}s</span>;
}
