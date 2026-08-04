/** Default canonical-only Novel card projectors for structured timeline cards. */
import {
  OUTPUT_EVENT_TYPE,
  type PersistedOutputEventSnapshot,
} from "@novel/core";
import {
  ConversationCardProjectorRegistry,
  type ConversationCardProjection,
} from "../card/index.js";

export function createDefaultNovelCardProjectorRegistry(): ConversationCardProjectorRegistry {
  return new ConversationCardProjectorRegistry([
    {
      eventType: OUTPUT_EVENT_TYPE.novelCommitCompleted,
      projector: projectNovelCommitCard,
    },
  ]);
}

function projectNovelCommitCard(
  event: PersistedOutputEventSnapshot,
): ConversationCardProjection | undefined {
  const payload = event.payload;
  if (
    typeof payload.novelId !== "string" ||
    payload.novelId.length === 0 ||
    typeof payload.commitId !== "string" ||
    payload.commitId.length === 0 ||
    typeof payload.operationCount !== "number" ||
    !Number.isSafeInteger(payload.operationCount)
  ) {
    return undefined;
  }
  return {
    cardId: `novel-commit:${event.id}`,
    kind: "novel-reference",
    title: "小说已提交",
    summary: `${payload.operationCount} 个操作已写入正文`,
    status: "completed",
    inspectorTarget: Object.freeze({
      key: "story-outline:canonical",
      kind: "story-outline",
      title: "故事大纲",
    }),
    inspectorSize: "normal",
  };
}
