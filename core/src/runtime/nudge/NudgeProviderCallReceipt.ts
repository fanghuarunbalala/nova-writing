/** Records the redacted application identity produced after a Provider dispatch barrier. */

export const NUDGE_PROVIDER_CALL_RECEIPT_STATUS = {
  applied: "applied",
} as const;

export type NudgeProviderCallReceiptStatus =
  (typeof NUDGE_PROVIDER_CALL_RECEIPT_STATUS)[keyof typeof NUDGE_PROVIDER_CALL_RECEIPT_STATUS];

export type NudgeProviderCallReceiptNudgeState = "consumed" | "active";

export interface NudgeProviderCallReceiptNudge {
  readonly nudgeId: string;
  readonly state: NudgeProviderCallReceiptNudgeState;
}

export interface NudgeProviderCallReceipt {
  readonly schemaVersion: 1;
  readonly deliveryIdentity: string;
  readonly conversationId: string;
  readonly runId: string;
  readonly providerCallId: string;
  readonly leaseId: string;
  readonly nudgeIds: readonly string[];
  readonly nudgeStates: readonly NudgeProviderCallReceiptNudge[];
  readonly applicationStatus: NudgeProviderCallReceiptStatus;
  readonly appliedAt: string;
}

export interface NudgeProviderCallReceiptRecordResult {
  readonly status: "recorded" | "duplicate";
  readonly receipt: NudgeProviderCallReceipt;
}

export interface NudgeProviderCallReceiptStore {
  record(
    receipt: NudgeProviderCallReceipt,
  ): Promise<NudgeProviderCallReceiptRecordResult>;

  getByProviderCallId(
    providerCallId: string,
  ): Promise<NudgeProviderCallReceipt | undefined>;
}

export class InMemoryNudgeProviderCallReceiptStore
  implements NudgeProviderCallReceiptStore
{
  private readonly receipts = new Map<string, NudgeProviderCallReceipt>();

  async record(
    receipt: NudgeProviderCallReceipt,
  ): Promise<NudgeProviderCallReceiptRecordResult> {
    const captured = captureReceipt(receipt);
    const existing = this.receipts.get(captured.providerCallId);
    if (existing) {
      if (!sameReceipt(existing, captured)) {
        throw new Error("Conflicting Nudge Provider call receipt");
      }
      return Object.freeze({ status: "duplicate", receipt: existing });
    }
    this.receipts.set(captured.providerCallId, captured);
    return Object.freeze({ status: "recorded", receipt: captured });
  }

  async getByProviderCallId(
    providerCallId: string,
  ): Promise<NudgeProviderCallReceipt | undefined> {
    const normalized = captureNonBlank(providerCallId);
    if (!normalized) throw new Error("Invalid Provider call ID");
    return this.receipts.get(normalized);
  }
}

export function createNudgeProviderCallReceipt(input: {
  readonly conversationId: string;
  readonly runId: string;
  readonly providerCallId: string;
  readonly leaseId: string;
  readonly nudgeIds: readonly string[];
  readonly nudgeStates: readonly NudgeProviderCallReceiptNudge[];
  readonly appliedAt: string;
}): NudgeProviderCallReceipt {
  const conversationId = captureNonBlank(input.conversationId);
  const runId = captureNonBlank(input.runId);
  const providerCallId = captureNonBlank(input.providerCallId);
  const leaseId = captureNonBlank(input.leaseId);
  const nudgeIds = captureIds(input.nudgeIds);
  const nudgeStates = captureNudgeStates(input.nudgeStates);
  if (
    !conversationId ||
    !runId ||
    !providerCallId ||
    !leaseId ||
    nudgeIds.length === 0 ||
    nudgeStates.length !== nudgeIds.length ||
    nudgeStates.some((item, index) => item.nudgeId !== nudgeIds[index]) ||
    !isTimestamp(input.appliedAt)
  ) {
    throw new Error("Invalid Nudge Provider call receipt");
  }
  return Object.freeze({
    schemaVersion: 1,
    deliveryIdentity: createDeliveryIdentity(providerCallId, leaseId),
    conversationId,
    runId,
    providerCallId,
    leaseId,
    nudgeIds: Object.freeze(nudgeIds),
    nudgeStates: Object.freeze(nudgeStates),
    applicationStatus: NUDGE_PROVIDER_CALL_RECEIPT_STATUS.applied,
    appliedAt: input.appliedAt,
  });
}

export function createDeliveryIdentity(
  providerCallId: string,
  leaseId: string,
): string {
  const provider = captureNonBlank(providerCallId);
  const lease = captureNonBlank(leaseId);
  if (!provider || !lease) throw new Error("Invalid Provider delivery identity");
  return `${provider}::${lease}`;
}

function captureReceipt(value: NudgeProviderCallReceipt): NudgeProviderCallReceipt {
  return createNudgeProviderCallReceipt({
    conversationId: value.conversationId,
    runId: value.runId,
    providerCallId: value.providerCallId,
    leaseId: value.leaseId,
    nudgeIds: value.nudgeIds,
    nudgeStates: value.nudgeStates,
    appliedAt: value.appliedAt,
  });
}

function captureIds(value: readonly string[]): string[] {
  if (!Array.isArray(value)) throw new Error("Invalid Nudge IDs");
  const ids = value.map((item) => captureNonBlank(item));
  if (ids.some((item): item is undefined => item === undefined)) {
    throw new Error("Invalid Nudge ID");
  }
  return ids as string[];
}

function captureNudgeStates(
  value: readonly NudgeProviderCallReceiptNudge[],
): NudgeProviderCallReceiptNudge[] {
  if (!Array.isArray(value)) throw new Error("Invalid Nudge states");
  return value.map((item) => {
    const nudgeId = captureNonBlank(item.nudgeId);
    if (!nudgeId || (item.state !== "consumed" && item.state !== "active")) {
      throw new Error("Invalid Nudge state");
    }
    return Object.freeze({ nudgeId, state: item.state });
  });
}

function sameReceipt(
  left: NudgeProviderCallReceipt,
  right: NudgeProviderCallReceipt,
): boolean {
  return (
    left.deliveryIdentity === right.deliveryIdentity &&
    left.conversationId === right.conversationId &&
    left.runId === right.runId &&
    left.providerCallId === right.providerCallId &&
    left.leaseId === right.leaseId &&
    left.applicationStatus === right.applicationStatus &&
    left.appliedAt === right.appliedAt &&
    JSON.stringify(left.nudgeIds) === JSON.stringify(right.nudgeIds) &&
    JSON.stringify(left.nudgeStates) === JSON.stringify(right.nudgeStates)
  );
}

function captureNonBlank(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    Number.isFinite(Date.parse(value));
}
