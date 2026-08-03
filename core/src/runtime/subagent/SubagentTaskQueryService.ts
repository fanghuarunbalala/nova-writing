/** Process-free TaskGet service backed only by durable Binding, Presence, and Message readers. */
import type { ConversationRuntimePresenceReader } from "../../conversation/ConversationRuntimePresenceReader.js";
import { noopLogger, type Logger } from "../../observability/index.js";
import type { ArtifactReference } from "../../storage/artifact/index.js";
import type { SubagentBindingStore } from "./SubagentBindingStore.js";
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
  readonly logger?: Logger;
}

export class SubagentTaskQueryService {
  readonly #bindings: SubagentBindingStore;
  readonly #runtimePresence: ConversationRuntimePresenceReader;
  readonly #finalAssistantMessages: SubagentFinalAssistantMessageReader;
  readonly #limits: SubagentTaskLimits;
  readonly #logger: Logger;

  constructor(options: SubagentTaskQueryServiceOptions) {
    this.#bindings = options.bindings;
    this.#runtimePresence = options.runtimePresence;
    this.#finalAssistantMessages = options.finalAssistantMessages;
    this.#limits = captureSubagentTaskLimits(options.limits);
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

    const presence = await this.#runtimePresence.getRuntimePresence(
      binding.childConversationId,
    );
    const result = binding.status === "completed"
      ? await this.#readResult(binding.childConversationId)
      : undefined;
    const snapshot = captureSubagentTaskSnapshot(
      {
        schemaVersion: 1,
        taskId: binding.subagentId,
        childConversationId: binding.childConversationId,
        status: toTaskStatus(binding.status),
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

function toRuntimePresence(
  state: "offline" | "starting" | "online" | "stopping" | "crashed",
): keyof typeof SUBAGENT_RUNTIME_PRESENCE {
  if (state === "online" || state === "starting") return "active";
  if (state === "offline" || state === "stopping") return "dormant";
  return "absent";
}
