export type InputReceiptStatus = "accepted" | "duplicate";

export interface InputReceipt {
  status: InputReceiptStatus;
  conversationId: string;
  inputEventId: string;
  sequence: number;
  acceptedAt: string;
}
