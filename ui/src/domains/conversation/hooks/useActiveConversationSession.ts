/**
 * useActiveConversationSession
 *
 * 活动会话 hook，两层拆分（gui-performance-2 功能点五）：
 * - useActiveConversationBinding：随 catalog.activeConversationId 建/拆投影 binding，
 *   只管生命周期不订阅快照——shell 持有不随流式发布重渲染；
 * - useActiveConversationSession：订阅 binding 快照（消费方局部重渲染）+ 会话方法。
 * 单 binding 不变量保持：ChatSurface 与审批域共用 shell 持有的同一实例。
 * conversationId 未定义（无活动会话）时返回空快照（null），方法调用抛错。
 */
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import type {
  ConversationApprovalDecision,
  ConversationMode,
  ConversationSystemControl,
  Logger,
  NovelApiClient,
  Receipt,
} from "@novel/core";
import type { ConversationTimelineItem } from "@novel/core/client";
import { ConversationProjectionBinding } from "../binding/ConversationProjectionBinding.js";
import type { ConversationProjectionBindingSnapshot } from "../binding/ConversationProjectionBindingTypes.js";

export interface ActiveConversationSession {
  /** 投影绑定快照（无活动会话为 null） */
  readonly snapshot: ConversationProjectionBindingSnapshot | null;
  /** 发送用户消息（无活动会话时 reject） */
  readonly sendUserMessage: (text: string) => Promise<Receipt>;
  /** 发送系统控制（mode.set / stop / reload.config） */
  readonly sendSystemControl: (ctrl: ConversationSystemControl) => Promise<Receipt>;
  /** 查询当前生效的会话模式 */
  readonly getConversationMode: () => Promise<ConversationMode>;
  /** 回传审批决策（无活动会话时 no-op） */
  readonly resolveApproval: (requestId: string, decision: ConversationApprovalDecision) => void;
  /** 恢复（失败后重试：重放 journal 增量 + 重建订阅） */
  readonly resume: () => Promise<void>;
}

/**
 * 打开并跟踪活动会话 binding（不订阅快照：shell 级持有，流式发布零重渲染）。
 * @param api 客户端门面
 * @param conversationId 活动会话 id（undefined = 无活动会话）
 * @param logger 可选日志
 * @returns 投影 binding（无活动会话为 undefined）
 */
export function useActiveConversationBinding(
  api: NovelApiClient,
  conversationId: string | undefined,
  logger?: Logger,
): ConversationProjectionBinding | undefined {
  const binding = useMemo(
    () =>
      conversationId !== undefined
        ? new ConversationProjectionBinding({
            api,
            conversationId,
            ...(logger !== undefined ? { logger } : {}),
          })
        : undefined,
    [api, conversationId, logger],
  );

  useEffect(() => {
    if (binding === undefined) return;
    void binding.start().catch(() => undefined);
    return () => {
      void binding.stop();
    };
  }, [binding]);

  return binding;
}

/**
 * 订阅 binding 快照并组装会话句柄（消费方局部：仅本 hook 调用组件随发布重渲染）。
 * @param binding 投影 binding（useActiveConversationBinding 产出；undefined = 无活动会话）
 * @returns 会话句柄（快照 + 发送 + 审批决策回传）
 */
export function useActiveConversationSession(
  binding: ConversationProjectionBinding | undefined,
): ActiveConversationSession {
  const subscribe = useCallback(
    (listener: () => void) => (binding !== undefined ? binding.subscribe(listener) : () => {}),
    [binding],
  );
  const getSnapshot = useCallback(
    () => (binding !== undefined ? binding.getSnapshot() : null),
    [binding],
  );
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const sendUserMessage = useCallback(
    (text: string): Promise<Receipt> => {
      if (binding === undefined) return Promise.reject(new Error("无活动会话"));
      return binding.sendUserMessage(text);
    },
    [binding],
  );
  const sendSystemControl = useCallback(
    (ctrl: ConversationSystemControl): Promise<Receipt> => {
      if (binding === undefined) return Promise.reject(new Error("无活动会话"));
      return binding.sendSystemControl(ctrl);
    },
    [binding],
  );
  const getConversationMode = useCallback((): Promise<ConversationMode> => {
    if (binding === undefined) return Promise.resolve("review");
    return binding.getConversationMode();
  }, [binding]);
  const resolveApproval = useCallback(
    (requestId: string, decision: ConversationApprovalDecision) => {
      binding?.resolveApproval(requestId, decision);
    },
    [binding],
  );
  const resume = useCallback(() => binding?.resume() ?? Promise.resolve(), [binding]);
  return useMemo(
    () =>
      Object.freeze({
        snapshot,
        sendUserMessage,
        sendSystemControl,
        getConversationMode,
        resolveApproval,
        resume,
      }),
    [getConversationMode, resolveApproval, resume, sendSystemControl, sendUserMessage, snapshot],
  );
}

/**
 * 选择 binding 投影中的首条用户消息（会话标题派生用）。
 * user 项跨快照引用稳定（core 投影 + mapper 缓存）→ 流式发布期间零重渲染。
 */
export function useFirstUserMessage(
  binding: ConversationProjectionBinding | undefined,
): ConversationTimelineItem | undefined {
  const subscribe = useCallback(
    (listener: () => void) => (binding !== undefined ? binding.subscribe(listener) : () => {}),
    [binding],
  );
  const getSnapshot = useCallback(
    () => binding?.getSnapshot().projection.timeline.find((item) => item.kind === "user"),
    [binding],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
