/** Stable Node JSONL transport failures without raw lines or stream errors. */
export const NODE_JSONL_IPC_FAILURE = {
  invalidChunk: "invalid_chunk",
  lineOversized: "line_oversized",
  incompleteLine: "incomplete_line",
  invalidJson: "invalid_json",
  invalidFrame: "invalid_frame",
  streamFailed: "stream_failed",
} as const;

export type NodeJsonlIpcFailure =
  (typeof NODE_JSONL_IPC_FAILURE)[keyof typeof NODE_JSONL_IPC_FAILURE];

export class NodeJsonlIpcError extends Error {
  readonly code = "NODE_JSONL_IPC_ERROR";

  constructor(readonly failure: NodeJsonlIpcFailure) {
    super(`Node JSONL IPC failure: ${failure}`);
    this.name = "NodeJsonlIpcError";
  }
}
