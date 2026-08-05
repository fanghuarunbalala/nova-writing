/**
 * useConversationProjection
 *
 * 打开并跟踪一条对话的 core 投影。桥接既有 ConversationProjectionBinding
 * （迁移期依赖，Phase 3 移除 legacy 时替换为域内实现），api/logger 由
 * 组合层注入，避免域消费 legacy 的 NovelApiContext。
 */
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import type { InputEvent, InputReceipt, Logger, NovelApiClient } from "@novel/core";
import { ConversationProjectionBinding } from "../../../conversation/ConversationProjectionBinding.js";
import type { ConversationProjectionBindingSnapshot } from "../../../conversation/ConversationProjectionBindingTypes.js";
import type { ConversationCardProjectorRegistry } from "../../../card/index.js";

export interface UseConversationProjectionDeps {
  readonly api: NovelApiClient;
  readonly logger?: Logger;
  readonly cardProjectors?: ConversationCardProjectorRegistry;
}

export interface ConversationProjectionHookResult {
  readonly snapshot: ConversationProjectionBindingSnapshot;
  readonly enqueue: (event: InputEvent) => Promise<InputReceipt>;
  readonly resume: () => Promise<void>;
}

export function useConversationProjection(
  conversationId: string,
  deps: UseConversationProjectionDeps,
): ConversationProjectionHookResult {
  const { api, logger, cardProjectors } = deps;
  const binding = useMemo(
    () =>
      new ConversationProjectionBinding({
        api,
        conversationId,
        ...(logger !== undefined ? { logger } : {}),
        ...(cardProjectors !== undefined ? { cardProjectors } : {}),
      }),
    [api, cardProjectors, conversationId, logger],
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

  const resume = useCallback(() => binding.resume(), [binding]);
  const enqueue = useCallback((event: InputEvent) => binding.enqueue(event), [binding]);
  return useMemo(
    () => Object.freeze({ snapshot, enqueue, resume }),
    [enqueue, resume, snapshot],
  );
}
