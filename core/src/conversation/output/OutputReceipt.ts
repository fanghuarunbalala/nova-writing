/** Durable acknowledgement returned after publishing one Conversation OutputEvent. */
export const OUTPUT_RECEIPT_STATUS = {
  recorded: "recorded",
  duplicate: "duplicate",
} as const;

export type OutputReceiptStatus =
  (typeof OUTPUT_RECEIPT_STATUS)[keyof typeof OUTPUT_RECEIPT_STATUS];

export interface OutputReceipt {
  readonly status: OutputReceiptStatus;
  readonly conversationId: string;
  readonly outputEventId: string;
  readonly sequence: number;
  readonly recordedAt: string;
}
