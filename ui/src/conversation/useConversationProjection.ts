/** React hook that opens, follows, resumes, and releases one Conversation projection. */
import {
  useCallback,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";
import type { InputEvent, InputReceipt } from "@novel/core";
import { useNovelApi } from "../client/NovelApiContext.js";
import { ConversationProjectionBinding } from "./ConversationProjectionBinding.js";
import type { ConversationProjectionBindingSnapshot } from "./ConversationProjectionBindingTypes.js";
import type { ConversationCardProjectorRegistry } from "../card/index.js";

export interface ConversationProjectionHookResult {
  readonly snapshot: ConversationProjectionBindingSnapshot;
  resume(): Promise<void>;
  enqueue(event: InputEvent): Promise<InputReceipt>;
}

export interface UseConversationProjectionOptions {
  readonly cardProjectors?: ConversationCardProjectorRegistry;
}

export function useConversationProjection(
  conversationId: string,
  options: UseConversationProjectionOptions = {},
): ConversationProjectionHookResult {
  const { api, logger } = useNovelApi();
  const binding = useMemo(
    () =>
      new ConversationProjectionBinding({
        api,
        conversationId,
        logger,
        ...(options.cardProjectors !== undefined
          ? { cardProjectors: options.cardProjectors }
          : {}),
      }),
    [api, conversationId, logger, options.cardProjectors],
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
  const enqueue = useCallback((event: InputEvent) => binding.enqueue(event), [binding]);
  return useMemo(
    () =>
      Object.freeze({
        snapshot,
        resume,
        enqueue,
      }),
    [enqueue, resume, snapshot],
  );
}
