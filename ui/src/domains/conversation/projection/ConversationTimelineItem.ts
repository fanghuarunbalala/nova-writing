/**
 * ConversationTimelineItem
 *
 * 对话时间线的数据模型（纯数据，不含 React 依赖）。
 * 卡片/工具痕迹由 core 事件投影产生，组件负责渲染；
 * 思考内容已随 loop 层丢弃 reasoning delta 移除（无 thinkLines 数据链）；
 * 「本轮时序」面板已移除，eventFlow 不再进入 UI 数据链。
 * assistant 项按 turn 分段（每段 = 内容片段 + 单行工具，见 docs/design/tool-call-embed-demo.html）；
 * ToolTraceView / AssistantSegment 由 core 投影直接产出（re-export，单一来源）。
 */
import type { ConversationCardDescriptor } from "./ConversationCardDescriptor.js";
import type { AssistantSegment, ToolTraceView } from "@novel/core/client";

export type { ToolTraceView, AssistantSegment };

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
      readonly revision?: string;
      /** 脱敏失败详情（provider 错误摘要）。Redacted failure detail. */
      readonly failureDetail?: string;
      readonly text: string;
      readonly cards: readonly ConversationCardDescriptor[];
      readonly streaming: boolean;
      /** turn 分段：每段 = 内容片段 + 该请求的工具行（无工具调用时为空数组） */
      readonly segments?: readonly AssistantSegment[];
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
