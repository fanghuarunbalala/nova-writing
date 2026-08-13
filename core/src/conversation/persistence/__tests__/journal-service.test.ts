import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileConversationJournalService } from "../FileConversationJournalService.js";
import { FileConversationJournalReadOnlyService } from "../FileConversationJournalReadOnlyService.js";
import type { TurnContext } from "../../../runtime/loop/types.js";

function makeTurn(seq: number, content: string): TurnContext {
  return {
    seq,
    messages: [{ role: "user", content }],
    ts: "t",
    appendTurnMessages: () => {},
  };
}

/** 嵌套布局：<root>/<conversationId>/journal.jsonl（写侧 storedir 布局） */
function nestedFile(root: string, conversationId: string): string {
  return join(root, conversationId, "journal.jsonl");
}

describe("FileConversationJournalService", () => {
  it("appendTurn 写 {seq, turn}（seq = turn.seq；同 seq 多写为快照更新；lastSeq 全行扫描恢复）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jrnl-"));
    const file = nestedFile(dir, "c1");
    const svc = new FileConversationJournalService({ conversationId: "c1", filePath: file });
    await svc.open();
    const r1 = await svc.appendTurn(makeTurn(1, "hi"));
    const r2 = await svc.appendTurn(makeTurn(1, "hi again"));
    const r3 = await svc.appendTurn(makeTurn(3, "next"));
    expect(r1.seq).toBe(1);
    expect(r2.seq).toBe(1); // 同 seq 重写
    expect(r3.seq).toBe(3);
    expect(svc.lastSeq).toBe(3);
    const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
    expect(lines).toHaveLength(3);
    // open 恢复：全行扫描取 max seq（非仅末行）
    const reopened = new FileConversationJournalService({ conversationId: "c1", filePath: file });
    await reopened.open();
    expect(reopened.lastSeq).toBe(3);
  });

  it("open 自动创建缺失目录", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jrnl-"));
    const file = join(dir, "missing", "c1", "journal.jsonl");
    const svc = new FileConversationJournalService({ conversationId: "c1", filePath: file });
    await svc.open();
    await svc.appendTurn(makeTurn(1, "hi"));
    expect(readFileSync(file, "utf8")).toContain("hi");
  });

  it("读侧 history 返回 OutputEvent（turn 边界 + 消息映射，无 delta）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jrnl-"));
    const file = nestedFile(dir, "c1");
    const svc = new FileConversationJournalService({ conversationId: "c1", filePath: file });
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
    const ro = new FileConversationJournalReadOnlyService({ journalDir: dir });
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
    const file = nestedFile(dir, "c1");
    const svc = new FileConversationJournalService({ conversationId: "c1", filePath: file });
    await svc.open();
    await svc.appendTurn(makeTurn(1, "first"));
    await svc.appendTurn(makeTurn(1, "second"));
    const ro = new FileConversationJournalReadOnlyService({ journalDir: dir });
    const events = await ro.history("c1", {});
    const userMsgs = events.filter((e) => e.type === "user.message");
    expect(userMsgs).toHaveLength(1);
    expect(userMsgs[0].text).toBe("second");
  });

  it("writeTurns 全量覆盖", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jrnl-"));
    const file = nestedFile(dir, "c1");
    const svc = new FileConversationJournalService({ conversationId: "c1", filePath: file });
    await svc.open();
    await svc.appendTurn(makeTurn(1, "old"));
    await svc.writeTurns([makeTurn(2, "new")]);
    const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
  });

  it("readTurns 返回去重后的持久化 turns（同 seq 取最新，无运行时闭包）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jrnl-"));
    const file = nestedFile(dir, "c1");
    const svc = new FileConversationJournalService({ conversationId: "c1", filePath: file });
    await svc.open();
    await svc.appendTurn(makeTurn(1, "first"));
    await svc.appendTurn(makeTurn(1, "second"));
    await svc.appendTurn(makeTurn(2, "third"));
    const ro = new FileConversationJournalReadOnlyService({ journalDir: dir });
    const turns = await ro.readTurns("c1");
    expect(turns.map((t) => t.seq)).toEqual([1, 2]);
    expect(turns[0]!.messages[0]!.content).toBe("second");
    expect("appendTurnMessages" in turns[0]!).toBe(false);
  });
});
