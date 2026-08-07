/**
 * 把当前 Compose 状态渲染为 system.reminder 消息草稿或 system-prompt overlay。
 * Renders the current Compose state as a system.reminder message draft or a
 * system-prompt overlay.
 *
 * 对齐 TodoPromptContributor：动态内容走 compose_reminder 消息（append-only）。
 */
import {
  CORE_RUNTIME_MESSAGE_TYPE,
} from "../message/schema/CoreRuntimeMessageSchemas.js";
import {
  RUNTIME_MESSAGE_SCHEMA_VERSION,
  type RuntimeMessageDraft,
} from "../message/RuntimeMessageSnapshot.js";
import {
  ComposeModeStateProvider,
  type ComposeModeSnapshot,
} from "./ComposeModeState.js";

export interface ComposeReminderMessageInput {
  readonly conversationId: string;
  readonly runId: string;
  readonly reminderId: string;
  readonly order: number;
  readonly timestamp: string;
}

/** 按会话把 compose 状态渲染为提示 overlay 或 reminder 草稿。 */
/** Renders per-conversation compose state into a prompt overlay or reminder draft. */
export class ComposePromptContributor {
  constructor(private readonly state: ComposeModeStateProvider) {}

  /** 把 overlay 追加到 system prompt（旧式兼容路径）。Appends the overlay to the system prompt. */
  async append(
    conversationId: string,
    systemPrompt: string,
  ): Promise<string> {
    const overlay = renderComposeOverlay(this.state.snapshot(conversationId));
    if (overlay === null) return systemPrompt;
    return systemPrompt.length === 0 ? overlay : `${systemPrompt}\n\n${overlay}`;
  }

  /** 构造 compose_reminder 消息草稿；无活动 compose 状态时返回 null。 */
  /** Builds a compose_reminder message draft; null when compose is not active. */
  buildReminderMessage(
    input: ComposeReminderMessageInput,
    snapshot: ComposeModeSnapshot,
  ): RuntimeMessageDraft | null {
    const overlay = renderComposeOverlay(snapshot);
    if (overlay === null) return null;
    return {
      role: "system",
      messageType: CORE_RUNTIME_MESSAGE_TYPE.systemReminder,
      schemaVersion: RUNTIME_MESSAGE_SCHEMA_VERSION,
      timestamp: input.timestamp,
      runId: input.runId,
      payload: {
        kind: "compose_reminder",
        content: overlay,
        order: input.order,
      },
    };
  }
}

/** 渲染 compose 状态 overlay；idle/applied/discarded 无 overlay。 */
/** Renders the compose overlay; idle/applied/discarded produce none. */
function renderComposeOverlay(snapshot: ComposeModeSnapshot): string | null {
  if (snapshot.phase === "designing") {
    return [
      "## 当前处于设计模式",
      "- 正式稿只读，唯一可写是当前会话的设计草稿文件。",
      "- 完成草稿后调用 **ExitComposeMode** 提交审批，不要用文本询问审批。",
    ].join("\n");
  }
  if (snapshot.phase === "pending") {
    return "设计草稿已提交，等待作者审批。";
  }
  return null;
}
