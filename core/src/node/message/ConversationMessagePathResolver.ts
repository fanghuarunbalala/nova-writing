/** Resolves opaque Conversation IDs to traversal-safe projection paths. */
import { resolve, join } from "node:path";
import type { MessageProjectionHasher } from "../../storage/index.js";
import { NodeSha256MessageProjectionHasher } from "./NodeSha256MessageProjectionHasher.js";

export interface ConversationMessagePaths {
  conversationKey: string;
  conversationDir: string;
  messageFilePath: string;
  lockFilePath: string;
}

export interface ConversationMessagePathResolverOptions {
  storeDir: string;
  hasher?: MessageProjectionHasher;
}

export class ConversationMessagePathResolver {
  readonly conversationsRoot: string;

  private readonly hasher: MessageProjectionHasher;

  constructor(options: ConversationMessagePathResolverOptions) {
    this.conversationsRoot = join(resolve(options.storeDir), "conversations");
    this.hasher = options.hasher ?? new NodeSha256MessageProjectionHasher();
  }

  resolve(conversationId: string): ConversationMessagePaths {
    if (conversationId.trim().length === 0) {
      throw new TypeError("conversationId must not be blank");
    }

    const conversationKey = this.hasher.digest(conversationId);
    if (!/^[a-f0-9]{64}$/.test(conversationKey)) {
      throw new TypeError("Conversation path hasher must return a lowercase SHA-256 digest");
    }
    const conversationDir = join(
      this.conversationsRoot,
      `conversation-${conversationKey}`,
    );
    return {
      conversationKey,
      conversationDir,
      messageFilePath: join(conversationDir, "messages.jsonl"),
      lockFilePath: join(conversationDir, "messages.lock"),
    };
  }
}
