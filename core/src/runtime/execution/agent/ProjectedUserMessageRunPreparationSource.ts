/**
 * Synchronizes canonical Messages and splits one claimed UserMessage Sequence
 * into the base transcript plus an explicit prompt invocation.
 */
import {
  canonicalStringifyJson,
  isAgentTurnInputEventType,
  type JsonValue,
} from "../../../event/index.js";
import { noopLogger, type Logger } from "../../../observability/index.js";
import type {
  ConversationMessageFilePage,
  ConversationMessageFileStore,
  ConversationMessageProjectionService,
  MessageProjectionMaintenanceResult,
  MessageProjectionMessageRecord,
} from "../../../storage/index.js";
import { AGENT_RUNTIME_INVOCATION_KIND } from "../../agent/index.js";
import {
  CORE_RUNTIME_MESSAGE_TYPE,
  RUNTIME_MESSAGE_SCHEMA_VERSION,
  coreRuntimeMessageSchemaRegistry,
  type RuntimeMessageSchemaRegistry,
  type RuntimeMessageSnapshot,
} from "../../message/index.js";
import type {
  RuntimeRunExecutionRequest,
} from "../control/RuntimeUserMessageInputHandler.js";
import {
  PROJECTED_RUN_PREPARATION_FAILURE,
  ProjectedUserMessageRunPreparationError,
  type ProjectedRunPreparationFailure,
} from "./ProjectedUserMessageRunPreparationSourceErrors.js";
import type {
  RuntimeRunPreparation,
  RuntimeRunPreparationSource,
} from "./RuntimeRunPreparationSource.js";
import type { RuntimeBasePromptSource } from "./RuntimeSystemPromptSource.js";
import type { PromptBase } from "../../../prompt/index.js";

const DEFAULT_PAGE_SIZE = 128;

export interface ProjectedUserMessageRunPreparationSourceOptions {
  conversationId: string;
  projections: ConversationMessageProjectionService;
  messages: ConversationMessageFileStore;
  basePromptSource: RuntimeBasePromptSource;
  messageSchemaRegistry?: RuntimeMessageSchemaRegistry;
  pageSize?: number;
  logger?: Logger;
}

interface SelectedMessages {
  readonly context: readonly RuntimeMessageSnapshot[];
  readonly prompt: readonly RuntimeMessageSnapshot[];
  readonly projectedThroughSequence: number;
  readonly highWatermarkMessageIndex: number;
}

export class ProjectedUserMessageRunPreparationSource
  implements RuntimeRunPreparationSource
{
  private readonly conversationId: string;
  private readonly projections: ConversationMessageProjectionService;
  private readonly messages: ConversationMessageFileStore;
  private readonly basePromptSource: RuntimeBasePromptSource;
  private readonly messageSchemaRegistry: RuntimeMessageSchemaRegistry;
  private readonly pageSize: number;
  private readonly logger: Logger;

  constructor(options: ProjectedUserMessageRunPreparationSourceOptions) {
    assertNonBlank("Conversation ID", options.conversationId);
    this.conversationId = options.conversationId;
    this.projections = options.projections;
    this.messages = options.messages;
    this.basePromptSource = options.basePromptSource;
    this.messageSchemaRegistry =
      options.messageSchemaRegistry ?? coreRuntimeMessageSchemaRegistry;
    this.pageSize = capturePageSize(options.pageSize ?? DEFAULT_PAGE_SIZE);
    this.logger = (options.logger ?? noopLogger).child({
      component: "projected_user_message_run_preparation_source",
      conversationId: this.conversationId,
    });
  }

  async prepare(request: RuntimeRunExecutionRequest): Promise<RuntimeRunPreparation> {
    let captured: RuntimeRunExecutionRequest;
    try {
      captured = captureRequest(request, this.conversationId);
    } catch {
      throw this.fail(PROJECTED_RUN_PREPARATION_FAILURE.invalidRequest);
    }
    this.logger.info("runtime.run_preparation.started", toLogIdentity(captured));

    const projection = await this.synchronize(captured);
    const basePrompt = await this.resolveBasePrompt(captured);
    const selected = await this.selectMessages(captured, projection);

    this.logger.info("runtime.run_preparation.completed", {
      ...toLogIdentity(captured),
      contextMessageCount: selected.context.length,
      promptMessageCount: selected.prompt.length,
      projectedThroughSequence: selected.projectedThroughSequence,
      highWatermarkMessageIndex: selected.highWatermarkMessageIndex,
    });
    return Object.freeze({
      conversationId: captured.conversationId,
      runId: captured.runId,
      basePrompt,
      messageHighWatermark: selected.highWatermarkMessageIndex,
      contextMessages: selected.context,
      invocation: Object.freeze({
        kind: AGENT_RUNTIME_INVOCATION_KIND.prompt,
        messages: selected.prompt,
      }),
    });
  }

  private async synchronize(
    request: RuntimeRunExecutionRequest,
  ): Promise<MessageProjectionMaintenanceResult> {
    let result: MessageProjectionMaintenanceResult;
    try {
      result = await this.projections.synchronize(request.conversationId);
    } catch {
      throw this.fail(
        PROJECTED_RUN_PREPARATION_FAILURE.projectionFailed,
        request,
      );
    }
    if (
      result?.conversationId !== request.conversationId ||
      !Array.isArray(result.operations) ||
      !Number.isSafeInteger(result.projectedThroughSequence) ||
      !Number.isSafeInteger(result.journalHighWatermark) ||
      !Number.isSafeInteger(result.processedEventCount) ||
      result.processedEventCount < 0 ||
      !Number.isSafeInteger(result.appendedMessageCount) ||
      result.appendedMessageCount < 0 ||
      result.projectedThroughSequence < request.input.sequence ||
      result.journalHighWatermark < request.input.sequence
    ) {
      throw this.fail(
        PROJECTED_RUN_PREPARATION_FAILURE.projectionBehindInput,
        request,
      );
    }
    this.logger.debug("runtime.run_preparation.projection_synchronized", {
      ...toLogIdentity(request),
      projectedThroughSequence: result.projectedThroughSequence,
      journalHighWatermark: result.journalHighWatermark,
      operationCount: result.operations.length,
      processedEventCount: result.processedEventCount,
      appendedMessageCount: result.appendedMessageCount,
    });
    return result;
  }

  private async resolveBasePrompt(
    request: RuntimeRunExecutionRequest,
  ): Promise<PromptBase> {
    let basePrompt: PromptBase;
    try {
      basePrompt = await this.basePromptSource.resolve(request);
    } catch {
      throw this.fail(
        PROJECTED_RUN_PREPARATION_FAILURE.basePromptFailed,
        request,
      );
    }
    if (
      basePrompt === null ||
      typeof basePrompt !== "object" ||
      typeof basePrompt.content !== "string"
    ) {
      throw this.fail(
        PROJECTED_RUN_PREPARATION_FAILURE.invalidBasePrompt,
        request,
      );
    }
    return basePrompt;
  }

  private async selectMessages(
    request: RuntimeRunExecutionRequest,
    projection: MessageProjectionMaintenanceResult,
  ): Promise<SelectedMessages> {
    const context: RuntimeMessageSnapshot[] = [];
    const prompt: RuntimeMessageSnapshot[] = [];
    const seenMessageIds = new Set<string>();
    let coreCurrentUserMessageCount = 0;
    let afterMessageIndex = 0;
    let expectedMessageIndex = 1;
    let previousSourceSequence = 0;
    let highWatermarkMessageIndex: number | undefined;
    let projectedThroughSequence: number | undefined;
    let reachedLaterSequence = false;

    do {
      let page: ConversationMessageFilePage;
      try {
        page = await this.messages.list({
          conversationId: request.conversationId,
          afterMessageIndex,
          ...(highWatermarkMessageIndex !== undefined
            ? { highWatermarkMessageIndex }
            : {}),
          limit: this.pageSize,
        });
      } catch {
        throw this.fail(
          PROJECTED_RUN_PREPARATION_FAILURE.messageReadFailed,
          request,
        );
      }

      try {
        const capturedPage = capturePage(
          page,
          request.conversationId,
          afterMessageIndex,
          highWatermarkMessageIndex,
          projectedThroughSequence,
        );
        highWatermarkMessageIndex = capturedPage.highWatermarkMessageIndex;
        projectedThroughSequence = capturedPage.projectedThroughSequence;
        if (
          projectedThroughSequence < request.input.sequence ||
          projectedThroughSequence < projection.projectedThroughSequence
        ) {
          throw new TypeError("Message page is behind synchronized projection");
        }

        for (const record of capturedPage.items) {
          const capturedRecord = captureMessageRecord(
            record,
            request.conversationId,
            expectedMessageIndex,
            previousSourceSequence,
            this.messageSchemaRegistry,
            seenMessageIds,
          );
          expectedMessageIndex += 1;
          previousSourceSequence = capturedRecord.source.sequence;

          if (capturedRecord.source.sequence > request.input.sequence) {
            reachedLaterSequence = true;
            break;
          }
          if (capturedRecord.source.sequence < request.input.sequence) {
            context.push(capturedRecord.message);
            continue;
          }
          if (
            capturedRecord.source.eventId !== request.input.id ||
            capturedRecord.source.eventType !== request.input.eventType ||
            capturedRecord.source.direction !== "input"
          ) {
            throw new TypeError("Current Input Message source is inconsistent");
          }
          prompt.push(capturedRecord.message);
          if (
            capturedRecord.message.role === "user" &&
            capturedRecord.message.messageType === CORE_RUNTIME_MESSAGE_TYPE.userMessage &&
            capturedRecord.message.schemaVersion === RUNTIME_MESSAGE_SCHEMA_VERSION
          ) {
            coreCurrentUserMessageCount += 1;
          }
        }

        if (reachedLaterSequence || !capturedPage.hasMore) break;
        const next = capturedPage.nextAfterMessageIndex;
        const last = capturedPage.items.at(-1)?.messageIndex;
        if (
          next === undefined ||
          last === undefined ||
          next !== last ||
          next <= afterMessageIndex
        ) {
          throw new TypeError("Message page continuation is invalid");
        }
        afterMessageIndex = next;
      } catch (error) {
        if (error instanceof ProjectedUserMessageRunPreparationError) throw error;
        throw this.fail(
          PROJECTED_RUN_PREPARATION_FAILURE.invalidMessagePage,
          request,
        );
      }
    } while (true);

    if (prompt.length === 0 || coreCurrentUserMessageCount === 0) {
      throw this.fail(
        PROJECTED_RUN_PREPARATION_FAILURE.currentInputMessageMissing,
        request,
      );
    }
    if (coreCurrentUserMessageCount !== 1) {
      throw this.fail(
        PROJECTED_RUN_PREPARATION_FAILURE.currentInputMessageAmbiguous,
        request,
      );
    }
    if (
      highWatermarkMessageIndex === undefined ||
      projectedThroughSequence === undefined
    ) {
      throw this.fail(
        PROJECTED_RUN_PREPARATION_FAILURE.currentInputMessageMissing,
        request,
      );
    }

    return Object.freeze({
      context: Object.freeze(context),
      prompt: Object.freeze(prompt),
      projectedThroughSequence,
      highWatermarkMessageIndex,
    });
  }

  private fail(
    failure: ProjectedRunPreparationFailure,
    request?: RuntimeRunExecutionRequest,
  ): ProjectedUserMessageRunPreparationError {
    this.logger.error("runtime.run_preparation.failed", {
      failure,
      ...(request !== undefined ? toLogIdentity(request) : {}),
    });
    return new ProjectedUserMessageRunPreparationError(
      this.conversationId,
      request?.runId,
      failure,
    );
  }
}

function captureRequest(
  request: RuntimeRunExecutionRequest,
  conversationId: string,
): RuntimeRunExecutionRequest {
  if (
    request === null ||
    typeof request !== "object" ||
    request.conversationId !== conversationId ||
    captureNonBlank(request.runId) === undefined ||
    request.input === null ||
    typeof request.input !== "object" ||
    request.input.direction !== "input" ||
    request.input.conversationId !== conversationId ||
    !isAgentTurnInputEventType(request.input.eventType) ||
    captureNonBlank(request.input.id) === undefined ||
    !Number.isSafeInteger(request.input.sequence) ||
    request.input.sequence <= 0
  ) {
    throw new TypeError("Projected Run preparation request is invalid");
  }
  return deepFreezeJson(
    JSON.parse(canonicalStringifyJson(request as unknown as JsonValue)),
  ) as RuntimeRunExecutionRequest;
}

function capturePage(
  page: ConversationMessageFilePage,
  conversationId: string,
  afterMessageIndex: number,
  fixedHighWatermark: number | undefined,
  fixedProjectedThrough: number | undefined,
): ConversationMessageFilePage {
  if (
    page === null ||
    typeof page !== "object" ||
    page.conversationId !== conversationId ||
    !Array.isArray(page.items) ||
    !Number.isSafeInteger(page.highWatermarkMessageIndex) ||
    page.highWatermarkMessageIndex < afterMessageIndex ||
    !Number.isSafeInteger(page.projectedThroughSequence) ||
    page.projectedThroughSequence < 0 ||
    typeof page.hasMore !== "boolean" ||
    (fixedHighWatermark !== undefined &&
      page.highWatermarkMessageIndex !== fixedHighWatermark) ||
    (fixedProjectedThrough !== undefined &&
      page.projectedThroughSequence !== fixedProjectedThrough)
  ) {
    throw new TypeError("Message page is invalid");
  }
  return page;
}

function captureMessageRecord(
  record: MessageProjectionMessageRecord,
  conversationId: string,
  expectedMessageIndex: number,
  previousSourceSequence: number,
  registry: RuntimeMessageSchemaRegistry,
  seenMessageIds: Set<string>,
): MessageProjectionMessageRecord {
  if (
    record === null ||
    typeof record !== "object" ||
    record.recordType !== "message" ||
    record.conversationId !== conversationId ||
    record.messageIndex !== expectedMessageIndex ||
    record.source === null ||
    typeof record.source !== "object" ||
    !Number.isSafeInteger(record.source.sequence) ||
    record.source.sequence <= 0 ||
    record.source.sequence < previousSourceSequence ||
    captureNonBlank(record.source.eventId) === undefined ||
    captureNonBlank(record.source.eventType) === undefined ||
    (record.source.direction !== "input" && record.source.direction !== "output") ||
    !Number.isSafeInteger(record.source.ordinal) ||
    record.source.ordinal < 0
  ) {
    throw new TypeError("Message record is invalid");
  }
  const message = registry.validateSnapshot(
    JSON.parse(
      canonicalStringifyJson(record.message as unknown as JsonValue),
    ),
  );
  if (
    message.conversationId !== conversationId ||
    seenMessageIds.has(message.id)
  ) {
    throw new TypeError("Runtime Message identity is invalid");
  }
  seenMessageIds.add(message.id);
  return Object.freeze({
    ...record,
    source: Object.freeze({ ...record.source }),
    message: deepFreezeJson(message),
  });
}

function capturePageSize(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 10_000) {
    throw new TypeError("Run preparation page size is invalid");
  }
  return value;
}

function toLogIdentity(request: RuntimeRunExecutionRequest): Readonly<{
  runId: string;
  inputEventId: string;
  eventType: string;
  sequence: number;
}> {
  return {
    runId: request.runId,
    inputEventId: request.input.id,
    eventType: request.input.eventType,
    sequence: request.input.sequence,
  };
}

function deepFreezeJson<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) deepFreezeJson(child);
    Object.freeze(value);
  }
  return value;
}

function assertNonBlank(label: string, value: string): void {
  if (captureNonBlank(value) === undefined) {
    throw new TypeError(`${label} must not be blank`);
  }
}

function captureNonBlank(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}
