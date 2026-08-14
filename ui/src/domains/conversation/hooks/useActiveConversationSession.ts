/**
 * useActiveConversationSession
 *
 * shell 级活动会话 hook：随 catalog.activeConversationId 建/拆投影 binding（单订阅，
 * 避免 ChatSurface 与审批域各开一条订阅导致事件双投）。
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
 * 打开并跟踪活动会话（shell 单订阅）。
 * @param api 客户端门面
 * @param conversationId 活动会话 id（undefined = 无活动会话）
 * @param logger 可选日志
 * @returns 会话句柄（快照 + 发送 + 审批决策回传）
 */
export function useActiveConversationSession(
  api: NovelApiClient,
  conversationId: string | undefined,
  logger?: Logger,
): ActiveConversationSession {
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
  const subscribe = useCallback(
    (listener: () => void) => (binding !== undefined ? binding.subscribe(listener) : () => {}),
    [binding],
  );
  const getSnapshot = useCallback(
    () => (binding !== undefined ? binding.getSnapshot() : null),
    [binding],
  );
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    if (binding === undefined) return;
    void binding.start().catch(() => undefined);
    return () => {
      void binding.stop();
    };
  }, [binding]);

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
