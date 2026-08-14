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

describe("projectedHistory（投影读取）", () => {
  /** 写一个含工具调用的 turn 并返回读侧 */
  async function setupToolTurn(dir: string): Promise<FileConversationJournalReadOnlyService> {
    const file = nestedFile(dir, "c1");
    const svc = new FileConversationJournalService({ conversationId: "c1", filePath: file });
    await svc.open();
    await svc.appendTurn({
      seq: 1,
      messages: [
        { role: "user", content: "写角色" },
        {
          role: "assistant",
          content: "好",
          toolCalls: [{ id: "t1", name: "CharacterWrite", args: '{"values":[{"name":"张三"}]}' }],
        },
        { role: "tool", content: "ok", id: "t1" },
      ],
      ts: "2026-08-14T10:00:00.000Z",
      appendTurnMessages: () => {},
    });
    return new FileConversationJournalReadOnlyService({ journalDir: dir });
  }

  it("tool-call 对投影为 tool-recorded.started/recorded，不含完整 request/response，preview 走纯目录", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jrnl-"));
    const ro = await setupToolTurn(dir);
    const events = await ro.projectedHistory("c1", {});
    const types = events.map((e) => e.type);
    expect(types).toContain("tool-recorded.started");
    expect(types).toContain("tool-recorded.recorded");
    expect(types).not.toContain("tool-call-request");
    expect(types).not.toContain("tool-call-response");
    const started = events.find((e) => e.type === "tool-recorded.started");
    expect(started).toMatchObject({ name: "CharacterWrite", preview: { title: "角色：张三" } });
    const recorded = events.find((e) => e.type === "tool-recorded.recorded");
    expect(recorded).toMatchObject({
      name: "CharacterWrite",
      outcome: "ok",
      preview: { title: "角色：张三", summary: "角色已写入" },
    });
  });

  it("与 history 的 turn 边界/消息事件一致（投影只替换工具调用形态）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jrnl-"));
    const ro = await setupToolTurn(dir);
    const complete = await ro.history("c1", {});
    const projected = await ro.projectedHistory("c1", {});
    const completeNonTool = complete.filter((e) => e.type !== "tool-call-request" && e.type !== "tool-call-response");
    const projectedNonTool = projected.filter(
      (e) => e.type !== "tool-recorded.started" && e.type !== "tool-recorded.recorded",
    );
    expect(projectedNonTool).toEqual(completeNonTool);
  });

  it("tool 消息无配对 request（orphan）→ recorded 按 unknown 兜底，不抛错", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jrnl-"));
    const file = nestedFile(dir, "c1");
    const svc = new FileConversationJournalService({ conversationId: "c1", filePath: file });
    await svc.open();
    await svc.appendTurn({
      seq: 1,
      messages: [{ role: "tool", content: "ok", id: "orphan" }],
      ts: "t",
      appendTurnMessages: () => {},
    });
    const ro = new FileConversationJournalReadOnlyService({ journalDir: dir });
    const events = await ro.projectedHistory("c1", {});
    expect(events.filter((e) => e.type === "tool-recorded.recorded")).toHaveLength(1);
    expect(events.find((e) => e.type === "tool-recorded.recorded")).toMatchObject({ name: "unknown" });
  });

  it("确定性：同一 journal 读两次 projectedHistory 深等", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jrnl-"));
    const ro = await setupToolTurn(dir);
    expect(await ro.projectedHistory("c1", {})).toEqual(await ro.projectedHistory("c1", {}));
  });
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
