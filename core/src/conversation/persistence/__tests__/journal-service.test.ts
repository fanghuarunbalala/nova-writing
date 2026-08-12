import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConversationJournalService } from "../ConversationJournalService.js";
import { ConversationJournalReadOnlyService } from "../ConversationJournalReadOnlyService.js";
import type { TurnContext } from "../../../runtime/loop/types.js";

function makeTurn(seq: number, content: string): TurnContext {
  return {
    seq,
    messages: [{ role: "user", content }],
    ts: "t",
    appendTurnMessages: () => {},
  };
}

describe("ConversationJournalService", () => {
  it("appendTurn 写文件 + seq 递增", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jrnl-"));
    const file = join(dir, "c1.jsonl");
    const svc = new ConversationJournalService({ conversationId: "c1", filePath: file });
    await svc.open();
    const r1 = await svc.appendTurn(makeTurn(1, "hi"));
    const r2 = await svc.appendTurn(makeTurn(1, "hi again"));
    expect(r1.seq).toBe(1);
    expect(r2.seq).toBe(2);
    const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);
  });

  it("读侧 history 返回 OutputEvent（turn 边界 + 消息映射，无 delta）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jrnl-"));
    const file = join(dir, "c1.jsonl");
    const svc = new ConversationJournalService({ conversationId: "c1", filePath: file });
    await svc.open();
    await svc.appendTurn({
      seq: 1,
      messages: [
        { role: "user", content: "hi" },
        {
          role: "assistant",
          content: "hello",
          toolCalls: [{ id: "t1", name: "read", args: "{}" }],
        },
        { role: "tool", content: "ok", id: "t1" },
      ],
      ts: "t",
      appendTurnMessages: () => {},
    });
    const ro = new ConversationJournalReadOnlyService({ journalDir: dir });
    const events = await ro.history("c1", {});
    const types = events.map((e) => e.type);
    expect(types[0]).toBe("turn-start");
    expect(types).toContain("user.message");
    expect(types).toContain("assistant.message");
    expect(types).toContain("tool-call-request");
    expect(types).toContain("tool-call-response");
    expect(types).not.toContain("assistant.delta");
    expect(types.at(-1)).toBe("turn-end");
  });

  it("同 seq 多写，读侧取最新", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jrnl-"));
    const file = join(dir, "c1.jsonl");
    const svc = new ConversationJournalService({ conversationId: "c1", filePath: file });
    await svc.open();
    await svc.appendTurn(makeTurn(1, "first"));
    await svc.appendTurn(makeTurn(1, "second"));
    const ro = new ConversationJournalReadOnlyService({ journalDir: dir });
    const events = await ro.history("c1", {});
    const userMsgs = events.filter((e) => e.type === "user.message");
    expect(userMsgs).toHaveLength(1);
    expect(userMsgs[0].text).toBe("second");
  });

  it("writeTurns 全量覆盖", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jrnl-"));
    const file = join(dir, "c1.jsonl");
    const svc = new ConversationJournalService({ conversationId: "c1", filePath: file });
    await svc.open();
    await svc.appendTurn(makeTurn(1, "old"));
    await svc.writeTurns([makeTurn(2, "new")]);
    const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
  });
});
