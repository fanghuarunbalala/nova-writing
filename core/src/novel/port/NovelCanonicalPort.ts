/**
 * Provider-neutral canonical Novel write 端口：一批操作在一个自动短事务中执行，
 * 并支持读取当前 revision 作为乐观锁载体。
 * Provider-neutral canonical Novel write port: executes a batch of operations
 * in one automatic short transaction and reads the current revision as the
 * optimistic-lock carrier.
 */
import type { NovelOperationId } from "../identity/index.js";
import type { NovelOperation } from "../operation/index.js";
import type { NovelRevision } from "../version/index.js";

export interface NovelCanonicalWriteInput {
  readonly operations: readonly NovelOperation[];
  readonly conversationId: string;
  readonly baseRevision?: NovelRevision;
}

export interface NovelCanonicalWriteResult {
  readonly status: "applied";
  readonly operationIds: readonly NovelOperationId[];
  readonly baseRevision: NovelRevision;
  readonly resultRevision: NovelRevision;
}

export interface NovelCanonicalWritePort {
  applyOperations(
    input: NovelCanonicalWriteInput,
  ): Promise<NovelCanonicalWriteResult>;

  getCurrentRevision(): Promise<NovelRevision>;
}
