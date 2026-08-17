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
import type { AssistantSegment, ConversationMode, ToolTraceView } from "@novel/core/client";
import type { AskQuestionSpec, AskingQueueItem } from "@novel/core";

export type { ToolTraceView, AssistantSegment };

export type ConversationTimelineItem =
  | {
      readonly kind: "run";
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
      /** 发送幽灵项（乐观回显，真实 user.message 到达时被替换）：
       *  flight = 空闲发送「发送中」（旋转图标动画），queued = 生成/审批中
       *  再发送「排队中 Ns」。sequence 为本地合成（9e6+自增），不与 core 事件序号冲突。 */
      readonly kind: "queued";
      readonly sequence: number;
      readonly text: string;
      readonly queuedAt: number;
      readonly phase?: "flight" | "queued";
    }
  | {
      readonly kind: "assistant";
      readonly sequence: number;
      readonly agentLabel: string;
      readonly timestamp: number;
      readonly revision?: string;
      /** 脱敏失败详情（provider 错误摘要）。Redacted failure detail. */
      readonly failureDetail?: string;
      /** 建项时生效模式（core 投影在 assistant 建项点盖章；头部 chip 展示） */
      readonly mode?: ConversationMode;
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
      /** 提问项（AskUserQuestion 工具发起的流内提问卡；pending 交互、其余留痕）。
       *  sequence 为本地合成（8e6+），不与 core 事件序号冲突；数据与状态来自 CMS wait 队列。 */
      readonly kind: "ask";
      readonly sequence: number;
      readonly asking: AskingQueueItem;
    }
  | {
      /** 提问留影项（tool-recorded.recorded.ask 载荷派生；journal 重放同路径，
       *  历史位置精确——重开会话后富答案卡据此重建）。 */
      readonly kind: "askRecord";
      readonly sequence: number;
      readonly toolCallId: string;
      readonly questions: readonly AskQuestionSpec[];
      readonly result: string;
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
