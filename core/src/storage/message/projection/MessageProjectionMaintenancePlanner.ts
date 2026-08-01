/**
 * Pure decision model shared by inspection and future synchronization logic.
 * It performs no I/O and never mutates the Message projection file.
 */
import type { MessageProjectionFileScan } from "../file/index.js";
import type { MessageProjectionIdentity } from "./MessageProjectionIdentity.js";
import type { MessageProjectionInspection } from "./MessageProjectionMaintenance.js";
import { MessageProjectionInvariantError } from "./MessageProjectionMaintenanceErrors.js";

export type MessageProjectionSchemaCompatibility =
  | "compatible"
  | "unavailable"
  | "not_applicable";

export interface AssessMessageProjectionInput extends MessageProjectionIdentity {
  conversationId: string;
  journalHighWatermark: number;
  structuralScan: MessageProjectionFileScan;
  schemaCompatibility: MessageProjectionSchemaCompatibility;
}

export class MessageProjectionMaintenancePlanner {
  assess(input: AssessMessageProjectionInput): MessageProjectionInspection {
    this.assertInput(input);
    const scan = input.structuralScan;
    const base = {
      conversationId: input.conversationId,
      expectedProjectorId: input.projectorId,
      expectedProjectorVersion: input.projectorVersion,
      journalHighWatermark: input.journalHighWatermark,
      projectedThroughSequence: scan.state?.committedThroughSequence ?? 0,
      ...(scan.header !== undefined
        ? {
            actualProjectorId: scan.header.projectorId,
            actualProjectorVersion: scan.header.projectorVersion,
          }
        : {}),
    };

    if (scan.status === "missing") {
      return {
        ...base,
        health: "missing",
        recommendedAction: "initialize",
      };
    }

    if (
      scan.status === "corrupted" ||
      scan.header === undefined ||
      scan.state === undefined ||
      !scan.state.hasCommittedCheckpoint
    ) {
      return {
        ...base,
        health: "corrupted",
        recommendedAction: "rebuild",
        rebuildReason: "corrupted",
      };
    }

    if (
      scan.header.projectorId !== input.projectorId ||
      scan.header.projectorVersion !== input.projectorVersion
    ) {
      return {
        ...base,
        health: "projector_mismatch",
        recommendedAction: "rebuild",
        rebuildReason: "projector_changed",
      };
    }

    if (input.schemaCompatibility === "not_applicable") {
      throw new MessageProjectionInvariantError(
        "schemaCompatibility is required for a structurally usable matching projection",
      );
    }

    if (input.schemaCompatibility === "unavailable") {
      return {
        ...base,
        health: "schema_unavailable",
        recommendedAction: "restore_schema",
      };
    }

    if (input.journalHighWatermark < scan.state.committedThroughSequence) {
      return {
        ...base,
        health: "journal_regressed",
        recommendedAction: "rebuild",
        rebuildReason: "journal_regressed",
      };
    }

    if (scan.status === "repairable_tail") {
      return {
        ...base,
        health: "repairable_tail",
        recommendedAction: "truncate_and_catch_up",
      };
    }

    if (input.journalHighWatermark > scan.state.committedThroughSequence) {
      return {
        ...base,
        health: "behind",
        recommendedAction: "catch_up",
      };
    }

    return {
      ...base,
      health: "ready",
      recommendedAction: "none",
    };
  }

  private assertInput(input: AssessMessageProjectionInput): void {
    this.assertNonBlank("conversationId", input.conversationId);
    this.assertNonBlank("projectorId", input.projectorId);
    this.assertNonBlank("projectorVersion", input.projectorVersion);
    if (input.structuralScan.conversationId !== input.conversationId) {
      throw new MessageProjectionInvariantError(
        "Message projection Scan belongs to a different Conversation",
      );
    }
    if (!Number.isSafeInteger(input.journalHighWatermark) || input.journalHighWatermark < 0) {
      throw new MessageProjectionInvariantError(
        "journalHighWatermark must be a non-negative safe integer",
      );
    }
    if (
      input.schemaCompatibility !== "compatible" &&
      input.schemaCompatibility !== "unavailable" &&
      input.schemaCompatibility !== "not_applicable"
    ) {
      throw new MessageProjectionInvariantError(
        "schemaCompatibility is invalid",
      );
    }
  }

  private assertNonBlank(label: string, value: string): void {
    if (value.trim().length === 0) {
      throw new MessageProjectionInvariantError(`${label} must not be blank`);
    }
  }
}
