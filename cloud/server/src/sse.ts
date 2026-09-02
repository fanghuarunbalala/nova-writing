/**
 * SSE 事件扇出 hub（进程内版）。
 *
 * 档位 1/2：单写者进程内直接扇出即可；
 * 档位 3（多实例）：写路径事务提交后需 publish 到 Redis pub/sub，各实例订阅后各自推给
 * 各自的 SSE 连接（连接粘实例、事件不粘实例）——本 hub 的 publish/subscribe 接口即该演进的接缝。
 */
export interface SseEvent {
  type: string;
  conversationId: string;
  [key: string]: unknown;
}

export class SseHub {
  private subscribers = new Set<(event: SseEvent) => void>();

  publish(event: SseEvent): void {
    for (const s of this.subscribers) {
      try {
        s(event);
      } catch {
        // 单个订阅者写失败不应影响其他订阅者
      }
    }
  }

  subscribe(listener: (event: SseEvent) => void): () => void {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }
}
