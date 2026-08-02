/** Durable writer boundary for validated Novel lifecycle records. */
import type { NovelLifecycleRecord } from "../event/index.js";

export interface NovelLifecycleRecordWriter {
  recordCanonical(
    record: NovelLifecycleRecord,
  ): Promise<"recorded" | "duplicate">;
}
