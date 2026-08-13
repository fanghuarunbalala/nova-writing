import { describe, it, expect, vi } from "vitest";
import { journalListener } from "../JournalBridge.js";
import type { ConversationJournalService } from "../contract/journal/index.js";
import type { TurnContext } from "../../runtime/loop/types.js";

function mockJournal() {
  return {
    appendTurn: vi.fn().mockResolvedValue({ seq: 1, recordedAt: "t" }),
    writeTurns: vi.fn().mockResolvedValue(undefined),
  } as unknown as ConversationJournalService;
}

function makeTurn(): TurnContext {
  return { seq: 1, messages: [{ role: "user", content: "hi" }], ts: "t", appendTurnMessages: () => {} };
}

describe("journalListener（LoopContext → journal 映射）", () => {
  it("onTurnMessageAppend → appendTurn", async () => {
    const journal = mockJournal();
    const l = journalListener(journal);
    const turn = makeTurn();
    l.onTurnMessageAppend?.(turn, [{ role: "assistant", content: "ok" }]);
    expect((journal.appendTurn as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(turn);
  });

  it("onCompacted → writeTurns", async () => {
    const journal = mockJournal();
    const l = journalListener(journal);
    l.onCompacted?.([makeTurn()]);
    expect((journal.writeTurns as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
  });

  it("onClear → writeTurns([])", async () => {
    const journal = mockJournal();
    const l = journalListener(journal);
    l.onClear?.();
    expect((journal.writeTurns as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith([]);
  });
});
