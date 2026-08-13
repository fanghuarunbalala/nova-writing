/**
 * useConversationProjection
 *
 * 打开并跟踪一条对话的精简投影。桥接 ConversationProjectionBinding，
 * 暴露 sendUserMessage / sendSystemControl / resume（api/logger 由组合层注入）。
 */
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import type { ConversationSystemControl, Logger, NovelApiClient, Receipt } from "@novel/core";
import { ConversationProjectionBinding } from "../binding/ConversationProjectionBinding.js";
import type { ConversationProjectionBindingSnapshot } from "../binding/ConversationProjectionBindingTypes.js";

export interface UseConversationProjectionDeps {
  readonly api: NovelApiClient;
  readonly logger?: Logger;
}

export interface ConversationProjectionHookResult {
  readonly snapshot: ConversationProjectionBindingSnapshot;
  readonly sendUserMessage: (text: string) => Promise<Receipt>;
  readonly sendSystemControl: (ctrl: ConversationSystemControl) => Promise<Receipt>;
  readonly resume: () => Promise<void>;
}

export function useConversationProjection(
  conversationId: string,
  deps: UseConversationProjectionDeps,
): ConversationProjectionHookResult {
  const { api, logger } = deps;
  const binding = useMemo(
    () =>
      new ConversationProjectionBinding({
        api,
        conversationId,
        ...(logger !== undefined ? { logger } : {}),
      }),
    [api, conversationId, logger],
  );
  const subscribe = useCallback((listener: () => void) => binding.subscribe(listener), [binding]);
  const getSnapshot = useCallback(() => binding.getSnapshot(), [binding]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    void binding.start().catch(() => undefined);
    return () => {
      void binding.stop();
    };
  }, [binding]);

  const sendUserMessage = useCallback((text: string) => binding.sendUserMessage(text), [binding]);
  const sendSystemControl = useCallback(
    (ctrl: ConversationSystemControl) => binding.sendSystemControl(ctrl),
    [binding],
  );
  const resume = useCallback(() => binding.resume(), [binding]);
  return useMemo(
    () => Object.freeze({ snapshot, sendUserMessage, sendSystemControl, resume }),
    [sendSystemControl, sendUserMessage, resume, snapshot],
  );
}
