import { describe, it, expect, vi } from "vitest";
import { journalListener } from "../JournalBridge.js";
import type { ConversationJournalService } from "../contract/journal/index.js";
import type { RunContext } from "../../runtime/loop/types.js";

function mockJournal() {
  return {
    appendRun: vi.fn().mockResolvedValue({ seq: 1, recordedAt: "t" }),
    writeRuns: vi.fn().mockResolvedValue(undefined),
  } as unknown as ConversationJournalService;
}

function makeTurn(): RunContext {
  return { seq: 1, messages: [{ role: "user", content: "hi" }], ts: "t", appendRunMessages: () => {} };
}

describe("journalListener（LoopContext → journal 映射）", () => {
  it("onRunMessageAppend → appendRun", async () => {
    const journal = mockJournal();
    const l = journalListener(journal);
    const turn = makeTurn();
    l.onRunMessageAppend?.(turn, [{ role: "assistant", content: "ok" }]);
    expect((journal.appendRun as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(turn);
  });

  it("onCompacted → writeRuns", async () => {
    const journal = mockJournal();
    const l = journalListener(journal);
    l.onCompacted?.([makeTurn()]);
    expect((journal.writeRuns as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
  });

  it("onClear → writeRuns([])", async () => {
    const journal = mockJournal();
    const l = journalListener(journal);
    l.onClear?.();
    expect((journal.writeRuns as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith([]);
  });
});
