/**
 * ConversationTimelineItem
 *
 * 对话时间线的数据模型（纯数据，不含 React 依赖）。
 * thinkLines 与 cards 由 core 事件投影产生，组件负责渲染。
 */
import type { ConversationCardDescriptor } from "./ConversationCardDescriptor.js";

/** 运行时事件行（对话内"本轮时序"）。Runtime event row. */
export interface ConversationEventView {
  readonly sequence: number;
  readonly timestamp: number;
  readonly eventType: string;
  readonly family: "agent" | "system" | "novel" | "other";
  readonly summary?: string;
  /** 终态工具调用结果（失败时事件流显示"失败"标记）。Terminal trace outcome. */
  readonly outcome?: "ok" | "failed";
}

/** 工具调用行（对话内工具条）。Tool-trace row. */
export interface ToolTraceView {
  readonly traceId: string;
  readonly toolName: string;
  readonly stage?: string;
  readonly outcome: "ok" | "failed";
  readonly durationMs?: number;
}

export interface ThinkLineData {
  readonly id: string;
  readonly text: string;
  readonly tag?:
    | "伏笔"
    | "视角"
    | "地点"
    | "变更"
    | "语言"
    | "节奏"
    | "一致性";
}

export type ConversationTimelineItem =
  | {
      readonly kind: "turn";
      readonly sequence: number;
      readonly label: string;
      readonly timestamp: number;
    }
  | {
      readonly kind: "user";
      readonly sequence: number;
      readonly text: string;
      readonly timestamp: number;
    }
  | {
      readonly kind: "assistant";
      readonly sequence: number;
      readonly agentLabel: string;
      readonly timestamp: number;
      readonly approvalState?: "generating" | "completed" | "submitted" | "failed" | "cancelled";
      readonly revision?: string;
      readonly thinkLines: readonly ThinkLineData[];
      readonly text: string;
      readonly cards: readonly ConversationCardDescriptor[];
      readonly streaming: boolean;
      readonly eventFlow?: readonly ConversationEventView[];
      readonly toolTraces?: readonly ToolTraceView[];
    }
  | {
      readonly kind: "system";
      readonly sequence: number;
      readonly text: string;
      readonly timestamp: number;
      /** 工具审批行：携带 approvalRequestId 时可点击打开审批面板。 */
      readonly approvalRequestId?: string;
    };
