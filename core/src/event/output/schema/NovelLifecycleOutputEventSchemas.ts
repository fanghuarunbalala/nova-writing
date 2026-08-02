/** Registers the public, content-safe Novel lifecycle OutputEvent payloads. */
import { Type, type TSchema } from "typebox";
import { EVENT_SCHEMA_VERSION } from "../../protocol/EventMetadata.js";
import type { EventSchemaRegistry } from "../../protocol/EventSchemaRegistry.js";
import { OUTPUT_EVENT_TYPE } from "../OutputEventType.js";

const Id = Type.String({ minLength: 1, maxLength: 160 });
const Count = Type.Integer({ minimum: 0 });
const Revision = Id;
const DraftStatus = Type.Union([
  Type.Literal("active"), Type.Literal("awaiting-approval"),
  Type.Literal("rebasing"), Type.Literal("conflicted"),
  Type.Literal("committing"), Type.Literal("committed"),
  Type.Literal("rolled-back"),
]);
const ConflictKind = Type.Union([
  Type.Literal("field-modified"), Type.Literal("entity-deleted"),
  Type.Literal("entity-created"), Type.Literal("parent-changed"),
  Type.Literal("order-changed"), Type.Literal("manuscript-block-modified"),
  Type.Literal("domain-invariant"),
]);
const ResolutionStrategy = Type.Union([
  Type.Literal("keep-canonical"), Type.Literal("keep-draft"),
  Type.Literal("drop-operation"), Type.Literal("manual"),
]);

function payload(properties: Record<string, TSchema>) {
  return Type.Object(
    { lifecycleVersion: Type.Literal(1), novelId: Id, ...properties },
    { additionalProperties: false },
  );
}

export function registerNovelLifecycleOutputEventSchemas(
  registry: EventSchemaRegistry,
): void {
  const definitions = [
    [OUTPUT_EVENT_TYPE.novelDraftStarted, payload({ draftSessionId: Id, baseRevision: Revision })],
    [OUTPUT_EVENT_TYPE.novelDraftStatusChanged, payload({ draftSessionId: Id, previousStatus: DraftStatus, currentStatus: DraftStatus })],
    [OUTPUT_EVENT_TYPE.novelDraftRolledBack, payload({ draftSessionId: Id, baseRevision: Revision })],
    [OUTPUT_EVENT_TYPE.novelCommitCompleted, payload({ draftSessionId: Id, commitId: Id, baseRevision: Revision, resultRevision: Revision, operationCount: Count })],
    [OUTPUT_EVENT_TYPE.novelCommitRecovered, payload({ draftSessionId: Id, commitId: Id, resultRevision: Revision, recovery: Type.Union([Type.Literal("payload-regenerated"), Type.Literal("metadata-confirmed")]) })],
    [OUTPUT_EVENT_TYPE.novelRebasePrepared, payload({ sourceDraftSessionId: Id, candidateDraftSessionId: Id, sourceBaseRevision: Revision, candidateBaseRevision: Revision, operationCount: Count })],
    [OUTPUT_EVENT_TYPE.novelRebaseConflicted, payload({ sourceDraftSessionId: Id, candidateDraftSessionId: Id, candidateBaseRevision: Revision, conflictCount: Count })],
    [OUTPUT_EVENT_TYPE.novelRebaseResolved, payload({ sourceDraftSessionId: Id, conflictedCandidateDraftSessionId: Id, resolvedCandidateDraftSessionId: Id, candidateBaseRevision: Revision, effectiveOperationCount: Count })],
    [OUTPUT_EVENT_TYPE.novelRebasePromoted, payload({ sourceDraftSessionId: Id, resolvedCandidateDraftSessionId: Id, baseRevision: Revision })],
    [OUTPUT_EVENT_TYPE.novelConflictDetected, payload({ draftSessionId: Id, conflictId: Id, operationId: Id, kind: ConflictKind })],
    [OUTPUT_EVENT_TYPE.novelConflictResolved, payload({ draftSessionId: Id, conflictId: Id, strategy: ResolutionStrategy })],
    [OUTPUT_EVENT_TYPE.novelRecoveryCompleted, payload({ scope: Type.Union([Type.Literal("draft"), Type.Literal("commit"), Type.Literal("rebase"), Type.Literal("projection")]), outcome: Type.Union([Type.Literal("recovered"), Type.Literal("cleaned"), Type.Literal("verified"), Type.Literal("rebuilt")]), affectedCount: Count })],
  ] as const;
  for (const [eventType, payloadSchema] of definitions) {
    registry.register({
      kind: "output",
      eventType,
      schemaVersion: EVENT_SCHEMA_VERSION,
      payloadSchema,
    });
  }
}
