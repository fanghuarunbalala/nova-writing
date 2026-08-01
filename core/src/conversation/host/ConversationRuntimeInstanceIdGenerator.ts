/** Generates opaque identities for ephemeral Conversation Runtime instances. */
export interface ConversationRuntimeInstanceIdGenerator {
  generate(conversationId: string): string;
}

export class RandomConversationRuntimeInstanceIdGenerator
  implements ConversationRuntimeInstanceIdGenerator
{
  generate(_conversationId: string): string {
    return `rt_${crypto.randomUUID().replaceAll("-", "")}`;
  }
}
