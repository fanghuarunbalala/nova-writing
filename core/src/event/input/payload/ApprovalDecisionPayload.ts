/** Approval decision payload; trusted actor identity is intentionally excluded. */
import type { JsonObject } from "../../protocol/JsonValue.js";
import { EventPayload } from "./EventPayload.js";

export type ApprovalDecision = "approved" | "rejected";

export interface ApprovalDecisionPayloadOptions {
  readonly approvalRequestId: string;
  readonly decision: ApprovalDecision;
  readonly argumentDigest: `sha256:${string}`;
}

export class ApprovalDecisionPayload extends EventPayload {
  readonly approvalRequestId: string;
  readonly decision: ApprovalDecision;
  readonly argumentDigest: `sha256:${string}`;

  constructor(options: ApprovalDecisionPayloadOptions) {
    super();
    this.approvalRequestId = requireIdentity(
      "Approval request ID",
      options.approvalRequestId,
    );
    this.decision = requireDecision(options.decision);
    this.argumentDigest = requireDigest(options.argumentDigest);
  }

  toObject(): JsonObject {
    return {
      approvalRequestId: this.approvalRequestId,
      decision: this.decision,
      argumentDigest: this.argumentDigest,
    };
  }
}

function requireIdentity(label: string, value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value)
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function requireDecision(value: unknown): ApprovalDecision {
  if (value !== "approved" && value !== "rejected") {
    throw new TypeError("Approval decision is invalid");
  }
  return value;
}

function requireDigest(value: unknown): `sha256:${string}` {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new TypeError("Approval argument digest is invalid");
  }
  return value as `sha256:${string}`;
}
