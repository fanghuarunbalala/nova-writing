/** Supplies validated lifecycle timestamps without coupling the Host to timers. */
export interface ConversationHostClock {
  now(): string;
}

export class SystemConversationHostClock implements ConversationHostClock {
  now(): string {
    return new Date().toISOString();
  }
}
