/** Persists redacted parent projections before releasing structured child results. */
import { OUTPUT_EVENT_TYPE, SubagentCancelledOutputEvent, SubagentCompletedOutputEvent, SubagentFailedOutputEvent, SubagentProgressOutputEvent, SubagentStartedOutputEvent } from "../../event/index.js";
import { noopLogger, type Logger } from "../../observability/index.js";
import type { RuntimeEventSink } from "../execution/index.js";
import type { ChildConversationManager } from "./ChildConversationManagerProtocol.js";
import { SUBAGENT_LIFECYCLE_FAILURE, SubagentLifecycleCoordinatorError, type SubagentLifecycleFailure } from "./SubagentLifecycleCoordinatorErrors.js";
import type { SubagentLifecycleClock, SubagentLifecycleCoordinator, SubagentLifecycleEventIdFactory, SubagentLifecycleHandle, SubagentProgressReport } from "./SubagentLifecycleCoordinatorProtocol.js";
import { SUBAGENT_STATUS, type SubagentBinding, type SubagentRequest, type SubagentResult } from "./SubagentProtocol.js";
import { captureSubagentRequest, captureSubagentResult } from "./SubagentProtocolValidator.js";

const IDENTITY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const PROGRESS_CODE = /^[a-z][a-z0-9_.-]{0,127}$/;

export interface DefaultSubagentLifecycleCoordinatorOptions {
  readonly manager: ChildConversationManager;
  readonly eventSink: RuntimeEventSink;
  readonly eventIdFactory: SubagentLifecycleEventIdFactory;
  readonly clock?: SubagentLifecycleClock;
  readonly logger?: Logger;
}

interface LifecycleEntry {
  readonly binding: SubagentBinding;
  readonly resultPromise: Promise<SubagentResult>;
  readonly resolveResult: (result: SubagentResult) => void;
  progressOrdinal: number;
  terminalResult?: SubagentResult;
}

export class DefaultSubagentLifecycleCoordinator implements SubagentLifecycleCoordinator {
  readonly #entries = new Map<string, LifecycleEntry>();
  readonly #tails = new Map<string, Promise<void>>();
  readonly #clock: SubagentLifecycleClock;
  readonly #logger: Logger;

  constructor(private readonly options: DefaultSubagentLifecycleCoordinatorOptions) {
    this.#clock = options.clock ?? SYSTEM_SUBAGENT_LIFECYCLE_CLOCK;
    this.#logger = (options.logger ?? noopLogger).child({ component: "subagent_lifecycle_coordinator" });
  }

  async start(requestSource: SubagentRequest): Promise<SubagentLifecycleHandle> {
    let request: SubagentRequest;
    try { request = captureSubagentRequest(requestSource); }
    catch { throw this.#failure(SUBAGENT_LIFECYCLE_FAILURE.startFailed); }

    let binding: SubagentBinding;
    try { binding = await this.options.manager.spawn(request); }
    catch {
      this.#logger.info("runtime.subagent.lifecycle_start_failed", { subagentId: request.subagentId, parentConversationId: request.parentConversationId, parentRunId: request.parentRunId, failure: SUBAGENT_LIFECYCLE_FAILURE.startFailed });
      throw this.#failure(SUBAGENT_LIFECYCLE_FAILURE.startFailed, request.subagentId, request.parentConversationId, request.parentRunId);
    }

    const entry = this.#createEntry(binding);
    this.#entries.set(binding.subagentId, entry);
    try {
      await this.#serialize(binding.subagentId, async () => {
        await this.options.eventSink.append(new SubagentStartedOutputEvent({
          id: this.#eventId(binding, OUTPUT_EVENT_TYPE.subagentStarted, 0),
          conversationId: binding.parentConversationId,
          runId: binding.parentRunId,
          ...(binding.parentTurnId === undefined ? {} : { turnId: binding.parentTurnId }),
          timestamp: binding.updatedAt,
          subagentId: binding.subagentId,
          childConversationId: binding.childConversationId,
          agentType: binding.agentType,
          definitionVersion: binding.definitionVersion,
          startedAt: binding.updatedAt,
        }));
      });
    } catch {
      this.#logger.error("runtime.subagent.started_projection_failed", { ...bindingIdentity(binding), failure: SUBAGENT_LIFECYCLE_FAILURE.startedProjectionFailed });
      throw this.#failure(SUBAGENT_LIFECYCLE_FAILURE.startedProjectionFailed, binding.subagentId, binding.parentConversationId, binding.parentRunId, binding.childConversationId);
    }

    this.#logger.info("runtime.subagent.lifecycle_started", bindingIdentity(binding));
    return Object.freeze({ binding, result: entry.resultPromise });
  }

  reportProgress(reportSource: SubagentProgressReport): Promise<void> {
    return this.#serialize(reportSource?.subagentId ?? "", async () => {
      const report = captureProgress(reportSource, this.#clock.now());
      const entry = this.#entries.get(report.subagentId);
      const binding = this.options.manager.getBinding(report.subagentId);
      if (!entry || !binding) throw this.#failure(SUBAGENT_LIFECYCLE_FAILURE.unknownSubagent, report.subagentId);
      if (binding.status !== SUBAGENT_STATUS.running) throw this.#failure(SUBAGENT_LIFECYCLE_FAILURE.childNotRunning, binding.subagentId, binding.parentConversationId, binding.parentRunId, binding.childConversationId);
      const ordinal = entry.progressOrdinal + 1;
      try {
        await this.options.eventSink.append(new SubagentProgressOutputEvent({
          id: this.#eventId(binding, OUTPUT_EVENT_TYPE.subagentProgress, ordinal),
          conversationId: binding.parentConversationId,
          runId: binding.parentRunId,
          ...(binding.parentTurnId === undefined ? {} : { turnId: binding.parentTurnId }),
          timestamp: report.reportedAt,
          subagentId: binding.subagentId,
          childConversationId: binding.childConversationId,
          progressCode: report.progressCode,
          ordinal,
          reportedAt: report.reportedAt,
        }));
      } catch { throw this.#failure(SUBAGENT_LIFECYCLE_FAILURE.progressProjectionFailed, binding.subagentId, binding.parentConversationId, binding.parentRunId, binding.childConversationId); }
      entry.progressOrdinal = ordinal;
      this.#logger.debug("runtime.subagent.progress_projected", { ...bindingIdentity(binding), ordinal });
    }).catch((error) => {
      const normalized = error instanceof SubagentLifecycleCoordinatorError ? error : this.#failure(SUBAGENT_LIFECYCLE_FAILURE.invalidProgress, reportSource?.subagentId);
      this.#logger.info("runtime.subagent.progress_failed", { ...(normalized.subagentId ? { subagentId: normalized.subagentId } : {}), failure: normalized.failure });
      throw normalized;
    });
  }

  deliverResult(resultSource: SubagentResult): Promise<SubagentResult> {
    let subagentId: string;
    try { subagentId = captureIdentity(resultSource?.subagentId); }
    catch { return Promise.reject(this.#failure(SUBAGENT_LIFECYCLE_FAILURE.invalidResult)); }
    return this.#serialize(subagentId, async () => {
      const binding = this.options.manager.getBinding(subagentId);
      if (!binding) throw this.#failure(SUBAGENT_LIFECYCLE_FAILURE.unknownSubagent, subagentId);
      let result: SubagentResult;
      try { result = captureSubagentResult(resultSource, binding); }
      catch { throw this.#failure(SUBAGENT_LIFECYCLE_FAILURE.invalidResult, binding.subagentId, binding.parentConversationId, binding.parentRunId, binding.childConversationId); }
      const entry = this.#entries.get(subagentId) ?? this.#createAndStoreEntry(binding);
      if (entry.terminalResult) {
        if (JSON.stringify(entry.terminalResult) !== JSON.stringify(result)) throw this.#failure(SUBAGENT_LIFECYCLE_FAILURE.duplicateResultConflict, binding.subagentId, binding.parentConversationId, binding.parentRunId, binding.childConversationId);
        return entry.terminalResult;
      }

      try { await this.options.eventSink.append(this.#terminalEvent(binding, result)); }
      catch { throw this.#failure(SUBAGENT_LIFECYCLE_FAILURE.terminalProjectionFailed, binding.subagentId, binding.parentConversationId, binding.parentRunId, binding.childConversationId); }

      const current = this.options.manager.getBinding(subagentId);
      if (current && current.status !== result.status) {
        try { await this.options.manager.recordTerminalStatus(subagentId, result.status, result.completedAt); }
        catch { throw this.#failure(SUBAGENT_LIFECYCLE_FAILURE.terminalTransitionFailed, binding.subagentId, binding.parentConversationId, binding.parentRunId, binding.childConversationId); }
      }
      entry.terminalResult = result;
      entry.resolveResult(result);
      this.#logger.info("runtime.subagent.result_delivered", { ...bindingIdentity(binding), status: result.status });
      return result;
    });
  }

  waitForResult(subagentIdSource: string): Promise<SubagentResult> {
    let subagentId: string;
    try { subagentId = captureIdentity(subagentIdSource); }
    catch { return Promise.reject(this.#failure(SUBAGENT_LIFECYCLE_FAILURE.unknownSubagent)); }
    const entry = this.#entries.get(subagentId);
    if (!entry) return Promise.reject(this.#failure(SUBAGENT_LIFECYCLE_FAILURE.unknownSubagent, subagentId));
    return entry.resultPromise;
  }

  #terminalEvent(binding: SubagentBinding, result: SubagentResult) {
    const base = { id: this.#eventId(binding, terminalEventType(result.status), 0), conversationId: binding.parentConversationId, runId: binding.parentRunId, ...(binding.parentTurnId === undefined ? {} : { turnId: binding.parentTurnId }), timestamp: result.completedAt, subagentId: binding.subagentId, childConversationId: binding.childConversationId, artifactReferences: result.artifactReferences };
    if (result.status === SUBAGENT_STATUS.completed) return new SubagentCompletedOutputEvent({ ...base, ...(result.summary === undefined ? {} : { summary: result.summary }), completedAt: result.completedAt });
    if (result.status === SUBAGENT_STATUS.failed) return new SubagentFailedOutputEvent({ ...base, outcome: "failed", errorCode: result.errorCode!, failedAt: result.completedAt });
    if (result.status === SUBAGENT_STATUS.orphaned) return new SubagentFailedOutputEvent({ ...base, outcome: "orphaned", cancellationReason: result.cancellationReason!, failedAt: result.completedAt });
    return new SubagentCancelledOutputEvent({ ...base, cancellationReason: result.cancellationReason!, cancelledAt: result.completedAt });
  }

  #eventId(binding: SubagentBinding, eventType: string, ordinal: number): string { return this.options.eventIdFactory.create({ parentConversationId: binding.parentConversationId, parentRunId: binding.parentRunId, subagentId: binding.subagentId, eventType, ordinal }); }
  #createAndStoreEntry(binding: SubagentBinding): LifecycleEntry { const entry = this.#createEntry(binding); this.#entries.set(binding.subagentId, entry); return entry; }
  #createEntry(binding: SubagentBinding): LifecycleEntry { let resolveResult!: (result: SubagentResult) => void; const resultPromise = new Promise<SubagentResult>((resolve) => { resolveResult = resolve; }); return { binding, resultPromise, resolveResult, progressOrdinal: 0 }; }
  #serialize<T>(subagentId: string, operation: () => Promise<T>): Promise<T> { const previous = this.#tails.get(subagentId) ?? Promise.resolve(); const result = previous.then(operation, operation); const tail = result.then(() => undefined, () => undefined); this.#tails.set(subagentId, tail); void tail.finally(() => { if (this.#tails.get(subagentId) === tail) this.#tails.delete(subagentId); }); return result; }
  #failure(failure: SubagentLifecycleFailure, subagentId?: string, parentConversationId?: string, parentRunId?: string, childConversationId?: string): SubagentLifecycleCoordinatorError { return new SubagentLifecycleCoordinatorError(failure, subagentId, parentConversationId, parentRunId, childConversationId); }
}

const SYSTEM_SUBAGENT_LIFECYCLE_CLOCK: SubagentLifecycleClock = Object.freeze({ now: () => new Date().toISOString() });
function captureProgress(value: unknown, defaultTimestamp: string): Required<SubagentProgressReport> { if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(); const record = value as Record<string, unknown>; const keys = Object.keys(record); if (keys.some((key) => !["subagentId", "progressCode", "reportedAt"].includes(key))) throw new Error(); const subagentId = captureIdentity(record.subagentId); if (typeof record.progressCode !== "string" || !PROGRESS_CODE.test(record.progressCode)) throw new Error(); const reportedAt = record.reportedAt === undefined ? defaultTimestamp : captureTimestamp(record.reportedAt); return Object.freeze({ subagentId, progressCode: record.progressCode, reportedAt }); }
function captureIdentity(value: unknown): string { if (typeof value !== "string" || !IDENTITY.test(value)) throw new Error(); return value; }
function captureTimestamp(value: unknown): string { if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new Error(); return value; }
function bindingIdentity(binding: SubagentBinding) { return { subagentId: binding.subagentId, parentConversationId: binding.parentConversationId, parentRunId: binding.parentRunId, childConversationId: binding.childConversationId }; }
function terminalEventType(status: SubagentResult["status"]): string { if (status === SUBAGENT_STATUS.completed) return OUTPUT_EVENT_TYPE.subagentCompleted; if (status === SUBAGENT_STATUS.cancelled) return OUTPUT_EVENT_TYPE.subagentCancelled; return OUTPUT_EVENT_TYPE.subagentFailed; }
