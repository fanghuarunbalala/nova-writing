/** Owns an opened Conversation and its minimal projection for one React consumer. */
import type {
  ConversationApprovalDecision,
  ConversationHandle,
  ConversationMode,
  ConversationSystemControl,
  ConversationUserMessage,
  Logger,
  NovelApiClient,
  Receipt,
} from "@novel/core";
import {
  ConversationProjection,
  noopLogger,
  type ConversationPlatformEventSource,
  type ConversationProjectionSnapshot,
} from "@novel/core/client";
import {
  CONVERSATION_PROJECTION_BINDING_STATE,
  type ConversationProjectionBindingListener,
  type ConversationProjectionBindingSnapshot,
  type ConversationProjectionBindingState,
} from "./ConversationProjectionBindingTypes.js";

export interface ConversationProjectionBindingOptions {
  readonly api: NovelApiClient;
  readonly conversationId: string;
  readonly logger?: Logger;
  /** 平台事件源（ZMQ 推送通道；缺省回退 kkrpc subscribeEvents） */
  readonly eventSource?: ConversationPlatformEventSource;
}

export class ConversationProjectionBinding {
  readonly conversationId: string;

  private readonly api: NovelApiClient;
  private readonly logger: Logger;
  /** 平台事件源（可选：ZMQ 推送通道；缺省投影走 kkrpc subscribeEvents） */
  private readonly eventSource?: ConversationPlatformEventSource;
  private readonly listeners = new Set<ConversationProjectionBindingListener>();
  private state: ConversationProjectionBindingState =
    CONVERSATION_PROJECTION_BINDING_STATE.idle;
  private snapshot: ConversationProjectionBindingSnapshot;
  private generation = 0;
  private handle?: ConversationHandle;
  private projection?: ConversationProjection;
  private unsubscribeProjection?: () => void;
  private startPromise?: Promise<void>;
  private stopPromise?: Promise<void>;

  constructor(options: ConversationProjectionBindingOptions) {
    this.api = options.api;
    this.conversationId = requireConversationId(options.conversationId);
    this.eventSource = options.eventSource;
    this.logger = (options.logger ?? noopLogger).child({
      component: "conversation_projection_binding",
      conversationId: this.conversationId,
    });
    this.snapshot = this.buildSnapshot();
  }

  getSnapshot(): ConversationProjectionBindingSnapshot {
    return this.snapshot;
  }

  subscribe(listener: ConversationProjectionBindingListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  start(): Promise<void> {
    if (this.state === CONVERSATION_PROJECTION_BINDING_STATE.active) {
      return Promise.resolve();
    }
    if (this.startPromise !== undefined) return this.startPromise;
    if (this.state !== CONVERSATION_PROJECTION_BINDING_STATE.idle) {
      return Promise.reject(new Error(`cannot start in state ${this.state}`));
    }
    const generation = ++this.generation;
    const tracked = this.startOnce(generation).finally(() => {
      if (this.startPromise === tracked) this.startPromise = undefined;
    });
    this.startPromise = tracked;
    return tracked;
  }

  /** 发送用户消息（run lane；references 由 core 序列化为实体标签追加正文）。 */
  sendUserMessage(message: ConversationUserMessage): Promise<Receipt> {
    return this.requireHandle().sendUserMessage(message);
  }

  /** 发送系统控制（control lane：mode.set / stop / reload.config）。 */
  sendSystemControl(ctrl: ConversationSystemControl): Promise<Receipt> {
    return this.requireHandle().sendSystemControl(ctrl);
  }

  /** 回传审批决策（解除 sendApprovalRequest 阻塞；decision: approve/reject/edit）。 */
  resolveApproval(requestId: string, decision: ConversationApprovalDecision): void {
    this.requireHandle().resolveApproval(requestId, decision);
  }

  /** 查询当前生效的会话模式（review/bypass/compose）；绑定未 active 时回退默认 review（启动时序无关） */
  getConversationMode(): Promise<ConversationMode> {
    if (this.state !== CONVERSATION_PROJECTION_BINDING_STATE.active || this.handle === undefined) {
      return Promise.resolve("review");
    }
    return this.handle.getConversationMode();
  }

  resume(): Promise<void> {
    return this.projection?.resume() ?? Promise.resolve();
  }

  /** 加载更早的历史页（分段加载 ⑤：UI 滚动到顶部触发；非 active 时 no-op） */
  loadOlder(): Promise<boolean> {
    return this.projection?.loadOlder() ?? Promise.resolve(false);
  }

  stop(): Promise<void> {
    this.stopPromise ??= this.stopOnce();
    return this.stopPromise;
  }

  private async startOnce(generation: number): Promise<void> {
    this.transition(CONVERSATION_PROJECTION_BINDING_STATE.opening);
    this.logger.info("novel_ui.conversation_projection.open_started", { generation });
    try {
      const handle = await this.api.conversations.open(this.conversationId);
      if (this.isSuperseded(generation)) {
        handle.dispose();
        return;
      }
      this.handle = handle;
      const projection = new ConversationProjection(
        handle,
        this.conversationId,
        (opts) => this.api.conversations.projectedHistory(this.conversationId, opts),
        this.eventSource,
      );
      this.projection = projection;
      this.unsubscribeProjection = projection.subscribe(() => this.publish());
      this.transition(CONVERSATION_PROJECTION_BINDING_STATE.active);
      await projection.start();
    } catch (error) {
      if (this.isSuperseded(generation)) return;
      this.transition(CONVERSATION_PROJECTION_BINDING_STATE.failed);
      console.error("[binding.open_failed]", error);
      this.logger.warn("novel_ui.conversation_projection.open_failed", {
        generation,
        errorName: getErrorName(error),
      });
      throw error;
    }
  }

  private async stopOnce(): Promise<void> {
    if (this.state === CONVERSATION_PROJECTION_BINDING_STATE.stopped) return;
    this.transition(CONVERSATION_PROJECTION_BINDING_STATE.stopping);
    this.generation += 1;
    const controller = this.projection;
    const startPromise = this.startPromise;
    await Promise.allSettled([
      ...(controller !== undefined ? [controller.stop()] : []),
      ...(startPromise !== undefined ? [startPromise] : []),
    ]);
    this.unsubscribeProjection?.();
    this.unsubscribeProjection = undefined;
    this.projection = undefined;
    const handle = this.handle;
    this.handle = undefined;
    handle?.dispose();
    this.transition(CONVERSATION_PROJECTION_BINDING_STATE.stopped);
    this.logger.info("novel_ui.conversation_projection.stopped");
  }

  private requireHandle(): ConversationHandle {
    if (this.state !== CONVERSATION_PROJECTION_BINDING_STATE.active || this.handle === undefined) {
      throw new Error(`conversation not active (state ${this.state})`);
    }
    return this.handle;
  }

  private isSuperseded(generation: number): boolean {
    return (
      generation !== this.generation ||
      this.state === CONVERSATION_PROJECTION_BINDING_STATE.stopping ||
      this.state === CONVERSATION_PROJECTION_BINDING_STATE.stopped
    );
  }

  private transition(state: ConversationProjectionBindingState): void {
    this.state = state;
    this.publish();
  }

  /**
   * 发布快照（直通转发：投影侧已做 32ms 合并窗口——delta 高发路径在
   * ConversationProjection 内压到 ~30Hz、状态迁移立即——本层不再叠加节流，
   * 避免双层窗口叠加延迟。见 gui-performance-2 功能点三。）
   */
  private publish(): void {
    this.deliver();
  }

  private deliver(): void {
    this.snapshot = this.buildSnapshot();
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch (error) {
        this.logger.error("novel_ui.conversation_projection.listener_failed", {
          errorName: getErrorName(error),
        });
      }
    }
  }

  private buildSnapshot(): ConversationProjectionBindingSnapshot {
    return Object.freeze({
      conversationId: this.conversationId,
      state: this.state,
      projection: this.projection?.getSnapshot() ?? emptyProjection(this.conversationId),
    });
  }
}

function emptyProjection(conversationId: string): ConversationProjectionSnapshot {
  return Object.freeze({
    conversationId,
    revision: 0,
    lastAppliedSequence: 0,
    state: "idle",
    timeline: Object.freeze([]),
    cards: Object.freeze([]),
    canLoadOlder: false,
    loadingOlder: false,
  });
}

function requireConversationId(value: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError("Conversation Projection Binding id must not be blank");
  }
  return value;
}

function getErrorName(error: unknown): string {
  if (error === null || typeof error !== "object") return "UnknownError";
  const name = (error as { name?: unknown }).name;
  return typeof name === "string" && name.trim().length > 0 ? name : "UnknownError";
}
