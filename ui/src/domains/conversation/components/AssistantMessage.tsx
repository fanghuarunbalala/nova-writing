/**
 * AssistantMessage
 *
 * 助手消息（对齐 app-redesign demo .msgAssistant）：头部行（渐变圆头像 +
 * 名称 + mono 时间 + 模式 chip）+ 正文片段与工具带交错（每段 = 内容片段 +
 * 工具行分组，live 与收口一致渲染、不丢段；重放回退全文 + 工具组，
 * 形态定稿见 docs/design/app-redesign-demo.html .msgHead/.toolGroup）
 * + 结构化卡片。
 * AskUserQuestion 作答留影卡内联在所属工具行下方（工具行 ask 载荷；原地留痕，
 * journal 重放同位置）。
 * 卡片通过 ConversationCardRendererRegistry 渲染。
 * memo 包裹：历史消息（text/cards/segments 引用稳定）零重渲染、markdown 零重解析。
 */
import { Fragment, memo, useEffect, useState, type JSX } from "react";
import { Check, Feather, X } from "lucide-react";
import { createDefaultConversationCardRendererRegistry } from "../cards/defaultRenderers.js";
import type { ConversationCardRendererRegistry } from "../cards/ConversationCardRendererRegistry.js";
import { Icon } from "../../../shared/primitives/Icon.js";
import type {
  ConversationCardDescriptor,
} from "../projection/ConversationCardDescriptor.js";
import type {
  AssistantSegment,
  ToolTraceView,
} from "../projection/ConversationTimelineItem.js";
import type { ConversationMode } from "@novel/core/client";
import type { ReferenceResolver } from "../reference/ReferenceResolver.js";
import type { ToastKind } from "../../../shared/state/ToastStore.js";
import { AssistantMarkdown } from "./assistantContent/AssistantMarkdown.js";
import { COMPOSER_MODE_META } from "./ComposerModeBar.js";
import { AskRecordCard } from "../../asking/components/AskRecordCard.js";
import type { MessageReference } from "./MessageReference.js";
import styles from "./AssistantMessage.module.css";

/** 缺省卡片渲染注册表（模块级单例：避免每 render 重建 registry） */
const DEFAULT_CARD_RENDERERS = createDefaultConversationCardRendererRegistry();

/** 缺省空数组（冻结单例：memo 浅比较稳定引用） */
const EMPTY_CARDS: readonly ConversationCardDescriptor[] = Object.freeze([]);
const EMPTY_SEGMENTS: readonly AssistantSegment[] = Object.freeze([]);

export interface AssistantMessageProps {
  readonly sequence: number;
  /** 头部显示名（timeline 统一「Novel 助理」） */
  readonly agentLabel: string;
  /** 消息事件时间（epoch ms；头部 meta 显示；缺省 0 → meta 不渲染） */
  readonly timestamp?: number;
  /** 保留兼容调用方；v2 原型 head 不再显示 revision。 */
  readonly revision?: string;
  readonly failureDetail?: string;
  /** 建项时生效模式（undefined 不渲染 chip） */
  readonly mode?: ConversationMode;
  readonly text: string;
  readonly cards?: readonly ConversationCardDescriptor[];
  readonly streaming?: boolean;
  /** 正文分段：每段 = 内容片段 + 其后工具批次（缺省空数组） */
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
  agentLabel,
  timestamp,
  failureDetail,
  text,
  cards = EMPTY_CARDS,
  streaming = false,
  segments = EMPTY_SEGMENTS,
  mode,
  onReferenceClick,
  onResolveReference,
  cardRenderers = DEFAULT_CARD_RENDERERS,
  onCardAction,
  onNotify,
}: AssistantMessageProps) {
  // 分段渲染（demo 定稿形态）：live 与收口一致——段文本完整（拼接 === 全文）时
  // 按段交错渲染「正文片段 + 工具组」；重放形态（段文本为空，拼接 ≠ 全文）回退
  // 「完整正文 + 各批工具组」。收口后不再丢弃早期正文片段与工具组（对齐 demo）。
  const segmentsComplete =
    segments.length > 0 && segments.map((seg) => seg.text).join("") === text;
  const replayTools = segments.filter((seg) => seg.tools.length > 0);
  const headTime = formatHeadTime(timestamp ?? 0);
  return (
    <div className={styles.message} data-sequence={sequence}>
      <div className={styles.head}>
        <span className={styles.avatar}>
          <Icon icon={Feather} size="xs" strokeWidth={2} />
        </span>
        <b>{agentLabel}</b>
        {headTime !== "" ? <span className={styles.meta}>{headTime}</span> : null}
        {mode !== undefined ? <span className={styles.chip}>{COMPOSER_MODE_META[mode]}</span> : null}
      </div>
      <div className={styles.body}>
        {segmentsComplete ? (
          segments.map((seg, i) => (
            <div key={i} className={styles.segment}>
              {seg.text !== "" ? (
                <div className={styles.text}>
                  <AssistantMarkdown
                    text={seg.text}
                    onReferenceClick={onReferenceClick}
                    resolveReference={onResolveReference}
                    streaming={streaming && i === segments.length - 1}
                    onNotify={onNotify}
                  />
                </div>
              ) : null}
              {seg.tools.length > 0 ? (
                <>
                  <div className={styles.toolGroup}>
                    <ToolLine tools={seg.tools} />
                  </div>
                  <AskToolRecords tools={seg.tools} />
                </>
              ) : null}
            </div>
          ))
        ) : (
          <>
            <div className={styles.text}>
              <AssistantMarkdown
                text={text}
                onReferenceClick={onReferenceClick}
                resolveReference={onResolveReference}
                streaming={streaming}
                onNotify={onNotify}
              />
            </div>
            {replayTools.map((seg, i) => (
              <Fragment key={i}>
                <div className={styles.toolGroup}>
                  <ToolLine tools={seg.tools} />
                </div>
                <AskToolRecords tools={seg.tools} />
              </Fragment>
            ))}
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

/** 头部时间格式化（demo .mMeta 文案）：今天→「今天 HH:mm」、昨天→「昨天 HH:mm」、
 *  同年→「M月D日 HH:mm」、更早→「YYYY年M月D日 HH:mm」；非法/空时间返回空串（meta 不渲染）。
 *  @param epochMs 事件时间（epoch 毫秒）
 *  @returns 格式化时间串，非法输入返回空串 */
function formatHeadTime(epochMs: number): string {
  if (epochMs <= 0 || Number.isNaN(epochMs)) return "";
  const date = new Date(epochMs);
  const now = new Date();
  const hhmm = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const dayDiff = Math.round((startOfToday - startOfDay) / 86_400_000);
  if (dayDiff === 0) return `今天 ${hhmm}`;
  if (dayDiff === 1) return `昨天 ${hhmm}`;
  if (date.getFullYear() === now.getFullYear()) {
    return `${date.getMonth() + 1}月${date.getDate()}日 ${hhmm}`;
  }
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${hhmm}`;
}

/** AskUserQuestion 作答留影：内联渲染在所属工具行下方（工具行 ask 载荷；
 *  原地留痕，journal 重放同位置重建）。 */
function AskToolRecords({
  tools,
}: {
  readonly tools: readonly ToolTraceView[];
}): JSX.Element | null {
  const asked = tools.filter((t) => t.ask !== undefined);
  if (asked.length === 0) return null;
  return (
    <div className={styles.askRecords}>
      {asked.map((t) => (
        <AskRecordCard
          key={t.traceId}
          toolCallId={t.traceId}
          questions={t.ask!.questions}
          result={t.ask!.result}
        />
      ))}
    </div>
  );
}

/** 工具单行（对齐 demo .toolLine 文案 `工具原名 · 摘要`，app-redesign-demo.html）：
 *  完成 = ✓ 绿图标 + muted（toolName · title/summary）；失败 = 红字 `toolName 失败：title`；
 *  进行中 = 唯一强调项（warn spinner + `toolName · title` + 实时整数秒）。
 *  工具项 nowrap，折行只发生在工具之间。 */
function ToolLine({ tools }: { readonly tools: readonly ToolTraceView[] }) {
  return (
    <div className={styles.toolLine}>
      {tools.map((t) => {
        const title = t.preview?.title;
        const sum = title ?? t.preview?.summary;
        if (t.outcome === undefined) {
          return (
            <span key={t.traceId} className={styles.toolRunning}>
              <span className={styles.spinner} />
              {t.toolName}
              {title !== undefined ? ` · ${title}` : ""}
              <LiveSeconds startedAt={t.startedAt} />
            </span>
          );
        }
        if (t.outcome === "failed") {
          return (
            <span key={t.traceId} className={styles.toolFailed}>
              <Icon icon={X} size="xs" strokeWidth={2.2} />
              {t.toolName} 失败{title !== undefined ? `：${title}` : ""}
            </span>
          );
        }
        return (
          <span key={t.traceId} className={styles.toolDone}>
            <Icon icon={Check} size="xs" strokeWidth={2.2} />
            {t.toolName}
            {sum !== undefined ? ` · ${sum}` : ""}
          </span>
        );
      })}
    </div>
  );
}

/** 进行中工具实时秒数（整数粒度，1s 跳动；startedAt 缺失时不渲染也不挂定时器） */
function LiveSeconds({ startedAt }: { readonly startedAt?: number }) {
  const active = startedAt !== undefined && !Number.isNaN(startedAt);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  if (!active) return null;
  const secs = Math.max(0, Math.floor((now - startedAt!) / 1000));
  return <span className={styles.toolSec}>{secs}s</span>;
}
