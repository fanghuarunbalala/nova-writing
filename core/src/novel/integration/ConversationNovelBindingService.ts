/** Coordinates Conversation identity binding without owning Conversation lifecycle. */
import type { NovelDraftSession } from "../draft/index.js";
import { captureNovelConversationId, captureNovelDraftSession } from "../draft/index.js";
import type { NovelId } from "../identity/index.js";
import type { ConversationNovelBindingStore, NovelClock } from "../port/index.js";
import type { ConversationNovelBinding } from "./ConversationNovelBinding.js";

export class ConversationNovelBindingService {
  constructor(
    private readonly novelId: NovelId,
    private readonly store: ConversationNovelBindingStore,
    private readonly clock: NovelClock,
  ) {}

  bind(conversationId: string): Promise<ConversationNovelBinding> {
    return this.store.bind({
      conversationId: captureNovelConversationId(conversationId),
      novelId: this.novelId,
      boundAt: this.clock.now(),
    });
  }

  bindActiveDraft(sessionInput: NovelDraftSession): Promise<ConversationNovelBinding> {
    const session = captureNovelDraftSession(sessionInput);
    return this.store.bindActiveDraft({
      conversationId: session.ownerConversationId,
      novelId: this.novelId,
      draftSessionId: session.id,
      boundAt: this.clock.now(),
    });
  }

  clearActiveDraft(
    conversationId: string,
    expectedDraftSessionId: NovelDraftSession["id"],
  ): Promise<ConversationNovelBinding> {
    return this.store.clearActiveDraft({
      conversationId: captureNovelConversationId(conversationId),
      novelId: this.novelId,
      expectedDraftSessionId,
      clearedAt: this.clock.now(),
    });
  }

  get(conversationId: string): Promise<ConversationNovelBinding | undefined> {
    return this.store.getBinding(
      this.novelId,
      captureNovelConversationId(conversationId),
    );
  }
}
