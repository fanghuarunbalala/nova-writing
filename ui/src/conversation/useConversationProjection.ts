/** React hook that opens, follows, resumes, and releases one Conversation projection. */
import {
  useCallback,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";
import { useNovelApi } from "../client/NovelApiContext.js";
import { ConversationProjectionBinding } from "./ConversationProjectionBinding.js";
import type { ConversationProjectionBindingSnapshot } from "./ConversationProjectionBindingTypes.js";

export interface ConversationProjectionHookResult {
  readonly snapshot: ConversationProjectionBindingSnapshot;
  resume(): Promise<void>;
}

export function useConversationProjection(
  conversationId: string,
): ConversationProjectionHookResult {
  const { api, logger } = useNovelApi();
  const binding = useMemo(
    () =>
      new ConversationProjectionBinding({
        api,
        conversationId,
        logger,
      }),
    [api, conversationId, logger],
  );
  const subscribe = useCallback(
    (listener: () => void) => binding.subscribe(listener),
    [binding],
  );
  const getSnapshot = useCallback(() => binding.getSnapshot(), [binding]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    void binding.start().catch(() => undefined);
    return () => {
      void binding.stop();
    };
  }, [binding]);

  const resume = useCallback(() => binding.resume(), [binding]);
  return useMemo(
    () =>
      Object.freeze({
        snapshot,
        resume,
      }),
    [resume, snapshot],
  );
}
