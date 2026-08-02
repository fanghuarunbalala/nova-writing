/** Redacted public Context Compaction lifecycle payloads. */
import type { JsonObject } from "../../protocol/JsonValue.js";
import { OutputPayload } from "../OutputPayload.js";

export interface ContextCompactionStartedPayloadOptions { providerCallId: string; trigger: "automatic" | "hard_admission_risk" | "explicit"; tokenEstimateBefore: number; targetTokens: number; hardAdmissionTokens: number; }
export class ContextCompactionStartedPayload extends OutputPayload {
  readonly providerCallId; readonly trigger; readonly tokenEstimateBefore; readonly targetTokens; readonly hardAdmissionTokens;
  constructor(options: ContextCompactionStartedPayloadOptions) { super(); validateBase(options); this.providerCallId = options.providerCallId; this.trigger = options.trigger; this.tokenEstimateBefore = options.tokenEstimateBefore; this.targetTokens = options.targetTokens; this.hardAdmissionTokens = options.hardAdmissionTokens; }
  toObject(): JsonObject { return { providerCallId: this.providerCallId, trigger: this.trigger, tokenEstimateBefore: this.tokenEstimateBefore, targetTokens: this.targetTokens, hardAdmissionTokens: this.hardAdmissionTokens }; }
}
export interface ContextCompactionCompletedPayloadOptions { providerCallId: string; checkpointId: string; outcome: "target_met" | "reduced" | "degraded"; sourceStartSequence: number; sourceEndSequence: number; tokenEstimateBefore: number; tokenEstimateAfter: number; }
export class ContextCompactionCompletedPayload extends OutputPayload {
  readonly providerCallId!: string; readonly checkpointId!: string; readonly outcome!: ContextCompactionCompletedPayloadOptions["outcome"]; readonly sourceStartSequence!: number; readonly sourceEndSequence!: number; readonly tokenEstimateBefore!: number; readonly tokenEstimateAfter!: number;
  constructor(options: ContextCompactionCompletedPayloadOptions) { super(); validateTerminal(options); requireNonBlank(options.checkpointId); Object.assign(this, options); }
  toObject(): JsonObject { return { providerCallId: this.providerCallId, checkpointId: this.checkpointId, outcome: this.outcome, sourceStartSequence: this.sourceStartSequence, sourceEndSequence: this.sourceEndSequence, tokenEstimateBefore: this.tokenEstimateBefore, tokenEstimateAfter: this.tokenEstimateAfter }; }
}
export interface ContextCompactionFailedPayloadOptions { providerCallId: string; failure: string; tokenEstimateBefore?: number; tokenEstimateAfter?: number; sourceStartSequence?: number; sourceEndSequence?: number; }
export class ContextCompactionFailedPayload extends OutputPayload {
  readonly providerCallId!: string; readonly failure!: string; readonly tokenEstimateBefore?: number; readonly tokenEstimateAfter?: number; readonly sourceStartSequence?: number; readonly sourceEndSequence?: number;
  constructor(options: ContextCompactionFailedPayloadOptions) { super(); requireNonBlank(options.providerCallId); requireNonBlank(options.failure); for (const value of [options.tokenEstimateBefore, options.tokenEstimateAfter, options.sourceStartSequence, options.sourceEndSequence]) if (value !== undefined) requireNonNegative(value); Object.assign(this, options); }
  toObject(): JsonObject { return { providerCallId: this.providerCallId, failure: this.failure, ...(this.tokenEstimateBefore === undefined ? {} : { tokenEstimateBefore: this.tokenEstimateBefore }), ...(this.tokenEstimateAfter === undefined ? {} : { tokenEstimateAfter: this.tokenEstimateAfter }), ...(this.sourceStartSequence === undefined ? {} : { sourceStartSequence: this.sourceStartSequence }), ...(this.sourceEndSequence === undefined ? {} : { sourceEndSequence: this.sourceEndSequence }) }; }
}
export interface ContextCheckpointAppliedPayloadOptions { providerCallId: string; checkpointId: string; }
export class ContextCheckpointAppliedPayload extends OutputPayload {
  readonly providerCallId; readonly checkpointId;
  constructor(options: ContextCheckpointAppliedPayloadOptions) { super(); requireNonBlank(options.providerCallId); requireNonBlank(options.checkpointId); this.providerCallId = options.providerCallId; this.checkpointId = options.checkpointId; }
  toObject(): JsonObject { return { providerCallId: this.providerCallId, checkpointId: this.checkpointId }; }
}
function validateBase(options: ContextCompactionStartedPayloadOptions): void { requireNonBlank(options.providerCallId); requireNonBlank(options.trigger); requireNonNegative(options.tokenEstimateBefore); requireNonNegative(options.targetTokens); requireNonNegative(options.hardAdmissionTokens); }
function validateTerminal(options: ContextCompactionCompletedPayloadOptions): void { requireNonBlank(options.providerCallId); requireNonBlank(options.outcome); for (const value of [options.sourceStartSequence, options.sourceEndSequence, options.tokenEstimateBefore, options.tokenEstimateAfter]) requireNonNegative(value); if (options.sourceEndSequence < options.sourceStartSequence) throw new TypeError("Context Compaction source range is invalid"); }
function requireNonBlank(value: unknown): asserts value is string { if (typeof value !== "string" || value.trim().length === 0) throw new TypeError("Context Compaction string is invalid"); }
function requireNonNegative(value: unknown): asserts value is number { if (!Number.isSafeInteger(value) || (value as number) < 0) throw new TypeError("Context Compaction integer is invalid"); }
