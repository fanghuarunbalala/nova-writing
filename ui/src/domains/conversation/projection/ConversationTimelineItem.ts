/**
 * ConversationTimelineItem
 *
 * 对话时间线的数据模型（纯数据，不含 React 依赖）。
 * thinkLines 与 cards 由 core 事件投影产生，组件负责渲染。
 * ConversationEventView / ToolTraceView 由 core 投影直接产出（re-export，单一来源）。
 */
import type { ConversationCardDescriptor } from "./ConversationCardDescriptor.js";
import type { ConversationEventView, ToolTraceView } from "@novel/core/client";

export type { ConversationEventView, ToolTraceView };

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
      /** 脱敏失败详情（provider 错误摘要）。Redacted failure detail. */
      readonly failureDetail?: string;
      readonly thinkLines: readonly ThinkLineData[];
      readonly text: string;
      readonly cards: readonly ConversationCardDescriptor[];
      readonly streaming: boolean;
      /** 流式中当前是否正在产出思考（activeChannel === "thinking"）。 */
      readonly thinking?: boolean;
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
    }
  | {
      readonly kind: "design";
      readonly sequence: number;
      readonly timestamp: number;
      readonly design: {
        readonly conversationId: string;
        readonly phase: string;
      };
    };
