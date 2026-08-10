/**
 * Compose 审批生命周期挂钩：ExitComposeMode 的 approval 事件驱动状态迁移与事件。
 * Compose approval lifecycle hook: ExitComposeMode approval events drive state
 * transitions and compose events.
 */
import type { OutputEvent } from "../../event/output/OutputEvent.js";
import { OUTPUT_EVENT_TYPE } from "../../event/output/OutputEventType.js";
import {
  ToolApprovalRequestedOutputEvent,
  ToolApprovalResolvedOutputEvent,
} from "../../event/output/ToolApprovalLifecycleOutputEvents.js";
import {
  ToolApprovalRequestedPayload,
  ToolApprovalResolvedPayload,
} from "../../event/output/payload/ToolApprovalLifecyclePayloads.js";
import type {
  RuntimeEventAppendReceipt,
  RuntimeEventSink,
} from "../execution/event/index.js";
import { ComposeModeStateProvider } from "./ComposeModeState.js";
import { NovelComposeOutputEvent } from "./NovelComposeOutputEvents.js";

/** 包装 eventSink：在 ExitComposeMode 审批请求/决议时同步 compose 状态并补发事件。 */
/** Wraps an event sink: on ExitComposeMode approval requests/resolutions it syncs state and emits events. */
export class ComposeApprovalLifecycleSink implements RuntimeEventSink {
  readonly #inner: RuntimeEventSink;
  readonly #state: ComposeModeStateProvider;

  constructor(inner: RuntimeEventSink, state: ComposeModeStateProvider) {
    this.#inner = inner;
    this.#state = state;
  }

  async append(event: OutputEvent): Promise<RuntimeEventAppendReceipt> {
    try {
      await this.#observe(event);
    } catch {
      // 非法迁移不阻断审批流，仅转发原始事件。
      // Invalid transitions never block the approval flow.
    }
    return this.#inner.append(event);
  }

  async #observe(event: OutputEvent): Promise<void> {
    const eventType = event.getEventType();
    if (
      eventType === OUTPUT_EVENT_TYPE.toolApprovalRequested &&
      event instanceof ToolApprovalRequestedOutputEvent
    ) {
      const payload = event.getPayload() as ToolApprovalRequestedPayload;
      if (payload.toolName === "ExitComposeMode") {
        const snapshot = this.#state.submit(event.conversationId);
        await this.#inner.append(
          new NovelComposeOutputEvent({
            eventName: "compose.submitted",
            conversationId: event.conversationId,
            ...(event.runId === undefined ? {} : { runId: event.runId }),
            payload: {
              designFilePath: snapshot.designFilePath ?? "",
              phase: snapshot.phase,
              approvalRequestId: payload.approvalRequestId,
            },
          }),
        );
      }
      return;
    }
    if (
      eventType === OUTPUT_EVENT_TYPE.toolApprovalResolved &&
      event instanceof ToolApprovalResolvedOutputEvent
    ) {
      const payload = event.getPayload() as ToolApprovalResolvedPayload;
      if (payload.toolName !== "ExitComposeMode") return;
      const before = this.#state.snapshot(event.conversationId);
      if (payload.decision === "approved") {
        await this.#inner.append(
          new NovelComposeOutputEvent({
            eventName: "compose.approved",
            conversationId: event.conversationId,
            ...(event.runId === undefined ? {} : { runId: event.runId }),
            payload: {
              designFilePath: before.designFilePath ?? "",
              phase: before.phase,
            },
          }),
        );
      } else if (payload.decision === "rejected") {
        const snapshot = this.#state.reject(event.conversationId);
        await this.#inner.append(
          new NovelComposeOutputEvent({
            eventName: "compose.rejected",
            conversationId: event.conversationId,
            ...(event.runId === undefined ? {} : { runId: event.runId }),
            payload: {
              designFilePath: snapshot.designFilePath ?? "",
              phase: snapshot.phase,
            },
          }),
        );
      }
    }
  }
}
