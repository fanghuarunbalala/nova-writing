/** Immutable link between one runtime Conversation identity and Novel editing state. */
import { captureNovelConversationId } from "../draft/index.js";
import { captureNovelDraftSessionId, captureNovelId, type NovelDraftSessionId, type NovelId } from "../identity/index.js";
import { captureNovelTimestamp, type NovelTimestamp } from "../version/index.js";

export interface ConversationNovelBinding {
  readonly conversationId: string;
  readonly novelId: NovelId;
  readonly activeDraftSessionId?: NovelDraftSessionId;
  readonly createdAt: NovelTimestamp;
  readonly updatedAt: NovelTimestamp;
}

export function captureConversationNovelBinding(
  value: ConversationNovelBinding,
): ConversationNovelBinding {
  return Object.freeze({
    conversationId: captureNovelConversationId(value.conversationId),
    novelId: captureNovelId(value.novelId),
    ...(value.activeDraftSessionId === undefined
      ? {}
      : { activeDraftSessionId: captureNovelDraftSessionId(value.activeDraftSessionId) }),
    createdAt: captureNovelTimestamp(value.createdAt),
    updatedAt: captureNovelTimestamp(value.updatedAt),
  });
}
