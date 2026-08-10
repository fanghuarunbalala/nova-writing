/**
 * 首条用户消息派生对话标题：仅当对话仍是默认标题("新对话"/空)时,用消息文本(截断)改名；
 * 已手动改名的对话跳过(保留用户命名)。
 * Derives a conversation title from the first user message: only renames when the title
 * is still the default; manually renamed conversations are left untouched.
 */
import type { ConversationCatalogStore } from "../../../storage/index.js";

/** 新会话默认标题(对齐 SqliteConversationCatalogStore 的 `input.title ?? "新对话"`)。 */
export const DEFAULT_CONVERSATION_TITLE = "新对话";

/** 首条消息作为标题的最大长度(超长截断加省略号)。 */
export const MAX_CONVERSATION_TITLE_LENGTH = 20;

/** 构造首条消息标题 deriver(经 catalog store 读写)。 */
export function createFirstMessageTitleDeriver(
  store: ConversationCatalogStore,
): (conversationId: string, text: string) => Promise<void> {
  return async (conversationId, text) => {
    const metadata = await store.getConversationMetadata(conversationId);
    const title = metadata?.title;
    // 已手动改名(非默认标题) → 保留,不覆盖。
    if (
      title !== undefined &&
      title.trim() !== "" &&
      title !== DEFAULT_CONVERSATION_TITLE
    ) {
      return;
    }
    const next = truncateTitle(text);
    if (next === "") return;
    await store.renameConversation(conversationId, next);
  };
}

export function truncateTitle(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= MAX_CONVERSATION_TITLE_LENGTH) return trimmed;
  return `${trimmed.slice(0, MAX_CONVERSATION_TITLE_LENGTH)}…`;
}
