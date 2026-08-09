/**
 * TaskGet 服务：仅基于持久 Binding/Presence/Message 读取；可选 completion 检查器在读路径
 * 上惰性终结子会话 run 终态。
 * TaskGet service backed by durable Binding, Presence, and Message readers; an
 * optional completion checker lazily finalizes terminal child Runs on read.
 */
import type { ConversationRuntimePresenceReader } from "../../conversation/ConversationRuntimePresenceReader.js";
import { noopLogger, type Logger } from "../../observability/index.js";
import type { ArtifactReference } from "../../storage/artifact/index.js";
import type { SubagentBindingStore } from "./SubagentBindingStore.js";
import { SUBAGENT_STATUS, type SubagentBinding } from "./SubagentProtocol.js";
import {
  SUBAGENT_RUNTIME_PRESENCE,
  SUBAGENT_TASK_STATUS,
  type SubagentTaskLimits,
  type SubagentTaskResult,
  type SubagentTaskSnapshot,
} from "./SubagentTaskProtocol.js";
import {
  captureSubagentTaskLimits,
  captureSubagentTaskSnapshot,
} from "./SubagentTaskProtocolValidator.js";

/** 惰性终结检查端口：探测并交付子会话 run 终态。Lazy completion check port. */
export interface SubagentCompletionCheck {
  check(binding: SubagentBinding): Promise<void>;
}

export interface SubagentFinalAssistantMessage {
  readonly content: string;
  readonly artifactReferences: readonly ArtifactReference[];
}

export interface SubagentFinalAssistantMessageReader {
  readFinalAssistantMessage(
    conversationId: string,
  ): Promise<SubagentFinalAssistantMessage | undefined>;
}

export interface SubagentTaskQueryScope {
  readonly parentConversationId: string;
  readonly parentRunId: string;
  readonly taskId: string;
}

export interface SubagentTaskQueryServiceOptions {
  readonly bindings: SubagentBindingStore;
  readonly runtimePresence: ConversationRuntimePresenceReader;
  readonly finalAssistantMessages: SubagentFinalAssistantMessageReader;
  readonly limits: SubagentTaskLimits;
  readonly completion?: SubagentCompletionCheck;
  readonly logger?: Logger;
}

export class SubagentTaskQueryService {
  readonly #bindings: SubagentBindingStore;
  readonly #runtimePresence: ConversationRuntimePresenceReader;
  readonly #finalAssistantMessages: SubagentFinalAssistantMessageReader;
  readonly #limits: SubagentTaskLimits;
  readonly #completion?: SubagentCompletionCheck;
  readonly #logger: Logger;

  constructor(options: SubagentTaskQueryServiceOptions) {
    this.#bindings = options.bindings;
    this.#runtimePresence = options.runtimePresence;
    this.#finalAssistantMessages = options.finalAssistantMessages;
    this.#limits = captureSubagentTaskLimits(options.limits);
    this.#completion = options.completion;
    this.#logger = (options.logger ?? noopLogger).child({
      component: "subagent_task_query",
    });
  }

  async get(scope: SubagentTaskQueryScope): Promise<SubagentTaskSnapshot | undefined> {
    const binding = await this.#bindings.get(scope.taskId);
    if (
      binding === undefined ||
      binding.parentConversationId !== scope.parentConversationId ||
      binding.parentRunId !== scope.parentRunId
    ) {
      this.#logger.debug("runtime.subagent.task_query.not_found", {
        taskId: scope.taskId,
        parentConversationId: scope.parentConversationId,
        parentRunId: scope.parentRunId,
      });
      return undefined;
    }

    // 惰性终结：非终态 binding 先探测子会话 run 终态；reconcile 可能翻转 binding 状态，
    // 故随后重读再构建 snapshot。Lazily finalize non-terminal bindings on read.
    if (this.#completion !== undefined && !isTerminalBinding(binding.status)) {
      await this.#completion.check(binding);
    }
    const latest = await this.#bindings.get(scope.taskId);
    if (latest === undefined) return undefined;

    const presence = await this.#runtimePresence.getRuntimePresence(
      latest.childConversationId,
    );
    const result = latest.status === "completed"
      ? await this.#readResult(latest.childConversationId)
      : undefined;
    const snapshot = captureSubagentTaskSnapshot(
      {
        schemaVersion: 1,
        taskId: latest.subagentId,
        childConversationId: latest.childConversationId,
        status: toTaskStatus(latest.status),
        runtimePresence: toRuntimePresence(presence.state),
        ...(result === undefined ? {} : { result }),
      },
      this.#limits,
    );
    this.#logger.debug("runtime.subagent.task_query.completed", {
      taskId: snapshot.taskId,
      status: snapshot.status,
      runtimePresence: snapshot.runtimePresence,
      hasResult: snapshot.result !== undefined,
    });
    return snapshot;
  }

  async #readResult(
    conversationId: string,
  ): Promise<SubagentTaskResult | undefined> {
    const message = await this.#finalAssistantMessages.readFinalAssistantMessage(
      conversationId,
    );
    if (message === undefined) return undefined;
    return Object.freeze({
      content: message.content,
      artifactReferences: Object.freeze([...message.artifactReferences]),
    });
  }
}

function toTaskStatus(status: string): keyof typeof SUBAGENT_TASK_STATUS {
  if (status === "creating") return "queued";
  if (status in SUBAGENT_TASK_STATUS) return status as keyof typeof SUBAGENT_TASK_STATUS;
  return "failed";
}

function isTerminalBinding(status: SubagentBinding["status"]): boolean {
  return (
    status === SUBAGENT_STATUS.completed ||
    status === SUBAGENT_STATUS.failed ||
    status === SUBAGENT_STATUS.cancelled ||
    status === SUBAGENT_STATUS.orphaned
  );
}

function toRuntimePresence(
  state: "offline" | "starting" | "online" | "stopping" | "crashed",
): keyof typeof SUBAGENT_RUNTIME_PRESENCE {
  if (state === "online" || state === "starting") return "active";
  if (state === "offline" || state === "stopping") return "dormant";
  return "absent";
}
