/**
 * ConversationTimelineItem
 *
 * 对话时间线的数据模型（纯数据，不含 React 依赖）。
 * thinkLines 与 cards 由 core 事件投影产生，组件负责渲染。
 */
import type { ConversationCardDescriptor } from "./ConversationCardDescriptor.js";

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
    }
  | {
      readonly kind: "system";
      readonly sequence: number;
      readonly text: string;
      readonly timestamp: number;
    };
