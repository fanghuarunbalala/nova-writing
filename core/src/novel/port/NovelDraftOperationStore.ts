/** Atomic Draft Operation Journal and transaction-context persistence boundary. */
import type { NovelDraftSession } from "../draft/index.js";
import type {
  NovelOperation,
  NovelOperationDigest,
} from "../operation/index.js";
import type { NovelTimestamp } from "../version/index.js";

export interface NovelDraftOperationReceipt {
  readonly status: "appended" | "duplicate";
  readonly sequence: number;
  readonly digest: NovelOperationDigest;
}

export interface AppendNovelDraftOperationInput<TContext> {
  readonly session: NovelDraftSession;
  readonly operation: NovelOperation;
  readonly digest: NovelOperationDigest;
  readonly recordedAt: NovelTimestamp;
  readonly apply: (context: TContext) => void;
}

export interface NovelDraftOperationStore<TContext> {
  appendOperation(
    input: AppendNovelDraftOperationInput<TContext>,
  ): Promise<NovelDraftOperationReceipt>;
}
