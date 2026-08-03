/** Redacted Tool Trace payload containing metadata only. */
import type { JsonObject } from "../../protocol/JsonValue.js";
import type { ToolTraceRecord } from "../../../runtime/tools/execution/ToolExecutionContracts.js";
import { OutputPayload } from "../OutputPayload.js";

export class ToolTraceRecordedPayload extends OutputPayload {
  readonly record: ToolTraceRecord;

  constructor(record: ToolTraceRecord) {
    super();
    this.record = record;
  }

  toObject(): JsonObject {
    const record = this.record;
    return {
      traceId: record.traceId,
      toolCallId: record.toolCallId,
      toolName: record.toolName,
      toolVersion: record.toolVersion,
      argumentDigest: record.argumentDigest,
      stage: record.stage,
      attempt: record.attempt,
      ...(record.durationMs === undefined ? {} : { durationMs: record.durationMs }),
      ...(record.inputBytes === undefined ? {} : { inputBytes: record.inputBytes }),
      ...(record.outputBytes === undefined ? {} : { outputBytes: record.outputBytes }),
      ...(record.ruleIds === undefined ? {} : { ruleIds: [...record.ruleIds] }),
      ...(record.permissionEffect === undefined
        ? {}
        : { permissionEffect: record.permissionEffect }),
      ...(record.approvalDecision === undefined
        ? {}
        : { approvalDecision: record.approvalDecision }),
      ...(record.approvalActorId === undefined
        ? {}
        : { approvalActorId: record.approvalActorId }),
      ...(record.artifactIds === undefined
        ? {}
        : { artifactIds: [...record.artifactIds] }),
      ...(record.errorCategory === undefined
        ? {}
        : { errorCategory: record.errorCategory }),
      ...(record.errorCode === undefined ? {} : { errorCode: record.errorCode }),
      ...(record.retryable === undefined ? {} : { retryable: record.retryable }),
      ...(record.sideEffectStatus === undefined
        ? {}
        : { sideEffectStatus: record.sideEffectStatus }),
    };
  }
}
