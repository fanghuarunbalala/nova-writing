/** Reads one stable structural/strict file assessment and Journal High Watermark. */
import type { RuntimeMessageProjector } from "../../../runtime/index.js";
import type { ConversationJournalReader } from "../../journal/index.js";
import type {
  MessageProjectionFileScan,
  ScanConversationMessageFileOptions,
} from "../file/index.js";
import { throwIfMessageProjectionAborted } from "./MessageProjectionAbort.js";
import type { MessageProjectionInspection } from "./MessageProjectionMaintenance.js";
import { MessageProjectionInspectionUnstableError } from "./MessageProjectionMaintenanceErrors.js";
import {
  MessageProjectionMaintenancePlanner,
  type MessageProjectionSchemaCompatibility,
} from "./MessageProjectionMaintenancePlanner.js";
import { MessageProjectionSchemaInspector } from "./MessageProjectionSchemaInspector.js";

export interface MessageProjectionAssessmentSnapshot {
  inspection: MessageProjectionInspection;
  structuralScan: MessageProjectionFileScan;
}

export type MessageProjectionFileScanOperation = (
  options?: ScanConversationMessageFileOptions,
) => Promise<MessageProjectionFileScan>;

export interface MessageProjectionAssessmentReaderOptions {
  journal: ConversationJournalReader;
  projector: RuntimeMessageProjector;
  planner?: MessageProjectionMaintenancePlanner;
  schemaInspector?: MessageProjectionSchemaInspector;
  retryCount?: number;
}

export class MessageProjectionAssessmentReader {
  private readonly journal: ConversationJournalReader;
  private readonly projector: RuntimeMessageProjector;
  private readonly planner: MessageProjectionMaintenancePlanner;
  private readonly schemaInspector: MessageProjectionSchemaInspector;
  private readonly retryCount: number;

  constructor(options: MessageProjectionAssessmentReaderOptions) {
    this.journal = options.journal;
    this.projector = options.projector;
    this.planner = options.planner ?? new MessageProjectionMaintenancePlanner();
    this.schemaInspector = options.schemaInspector ?? new MessageProjectionSchemaInspector();
    this.retryCount = options.retryCount ?? 2;
    if (!Number.isSafeInteger(this.retryCount) || this.retryCount < 0 || this.retryCount > 10) {
      throw new TypeError("retryCount must be an integer between 0 and 10");
    }
  }

  async read(
    conversationId: string,
    scan: MessageProjectionFileScanOperation,
    signal?: AbortSignal,
  ): Promise<MessageProjectionAssessmentSnapshot> {
    for (let attempt = 0; attempt <= this.retryCount; attempt += 1) {
      throwIfMessageProjectionAborted(conversationId, signal);
      const structuralScan = await scan({ allowUnknownMessageTypes: true });
      let schemaCompatibility: MessageProjectionSchemaCompatibility = "not_applicable";

      if (this.requiresStrictSchemaScan(structuralScan)) {
        const strictScan = await scan();
        if (!this.sameFileGeneration(structuralScan, strictScan)) continue;
        schemaCompatibility = this.schemaInspector.inspect(structuralScan, strictScan);
      }

      throwIfMessageProjectionAborted(conversationId, signal);
      const journalHighWatermark = await this.journal.getHighWatermark(conversationId);
      throwIfMessageProjectionAborted(conversationId, signal);
      return {
        structuralScan,
        inspection: this.planner.assess({
          conversationId,
          projectorId: this.projector.id,
          projectorVersion: this.projector.version,
          journalHighWatermark,
          structuralScan,
          schemaCompatibility,
        }),
      };
    }
    throw new MessageProjectionInspectionUnstableError(conversationId);
  }

  private requiresStrictSchemaScan(scan: MessageProjectionFileScan): boolean {
    return (
      (scan.status === "valid" || scan.status === "repairable_tail") &&
      scan.header !== undefined &&
      scan.state?.hasCommittedCheckpoint === true &&
      scan.header.projectorId === this.projector.id &&
      scan.header.projectorVersion === this.projector.version
    );
  }

  private sameFileGeneration(
    structural: MessageProjectionFileScan,
    strict: MessageProjectionFileScan,
  ): boolean {
    return (
      structural.totalByteLength === strict.totalByteLength &&
      structural.fileSnapshot?.size === strict.fileSnapshot?.size &&
      structural.fileSnapshot?.modifiedAtMs === strict.fileSnapshot?.modifiedAtMs &&
      structural.header?.recordHash === strict.header?.recordHash
    );
  }
}
