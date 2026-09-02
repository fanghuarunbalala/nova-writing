import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { FileConversationJournalService } from "../FileConversationJournalService.js";
import { FileConversationJournalReadOnlyService } from "../FileConversationJournalReadOnlyService.js";
import type { RunContext } from "../../../runtime/loop/types.js";

function makeTurn(seq: number, content: string): RunContext {
  return {
    seq,
    messages: [{ role: "user", content }],
    ts: "t",
    appendRunMessages: () => {},
  };
}

/** 嵌套布局：<root>/<conversationId>/journal.jsonl（写侧 storedir 布局） */
function nestedFile(root: string, conversationId: string): string {
  return join(root, conversationId, "journal.jsonl");
}

describe("FileConversationJournalService", () => {
  it("appendRun 写 {seq, turn}（seq = turn.seq；同 seq 多写为快照更新；lastSeq 全行扫描恢复）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jrnl-"));
    const file = nestedFile(dir, "c1");
    const svc = new FileConversationJournalService({ conversationId: "c1", filePath: file });
    await svc.open();
    const r1 = await svc.appendRun(makeTurn(1, "hi"));
    const r2 = await svc.appendRun(makeTurn(1, "hi again"));
    const r3 = await svc.appendRun(makeTurn(3, "next"));
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
    await svc.appendRun(makeTurn(1, "hi"));
    expect(readFileSync(file, "utf8")).toContain("hi");
  });

  it("读侧 history 返回 OutputEvent（turn 边界 + 消息映射，无 delta）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jrnl-"));
    const file = nestedFile(dir, "c1");
    const svc = new FileConversationJournalService({ conversationId: "c1", filePath: file });
    await svc.open();
    await svc.appendRun({
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
      appendRunMessages: () => {},
    });
    const ro = new FileConversationJournalReadOnlyService({ journalDir: dir });
    const events = await ro.history("c1", {});
    const types = events.map((e) => e.type);
    expect(types[0]).toBe("run-start");
    expect(types).toContain("user.message");
    expect(types).toContain("assistant.message");
    expect(types).toContain("tool-call-request");
    expect(types).toContain("tool-call-response");
    expect(types).not.toContain("assistant.delta");
    expect(types.at(-1)).toBe("run-end");
  });

describe("projectedHistory（投影读取）", () => {
  /** 写一个含工具调用的 turn 并返回读侧 */
  async function setupToolTurn(dir: string): Promise<FileConversationJournalReadOnlyService> {
    const file = nestedFile(dir, "c1");
    const svc = new FileConversationJournalService({ conversationId: "c1", filePath: file });
    await svc.open();
    await svc.appendRun({
      seq: 1,
      messages: [
        { role: "user", content: "写角色" },
        {
          role: "assistant",
          content: "好",
          toolCalls: [{ id: "t1", name: "NovelCharacterWrite", args: '{"values":[{"name":"张三"}]}' }],
        },
        { role: "tool", content: "ok", id: "t1" },
      ],
      ts: "2026-08-14T10:00:00.000Z",
      appendRunMessages: () => {},
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
    expect(started).toMatchObject({
      name: "NovelCharacterWrite",
      preview: { action: "创建", object: "角色", title: "张三" },
    });
    const recorded = events.find((e) => e.type === "tool-recorded.recorded");
    expect(recorded).toMatchObject({
      name: "NovelCharacterWrite",
      outcome: "ok",
      preview: { action: "创建", object: "角色", title: "张三", summary: "角色已写入" },
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
    await svc.appendRun({
      seq: 1,
      messages: [{ role: "tool", content: "ok", id: "orphan" }],
      ts: "t",
      appendRunMessages: () => {},
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
    await svc.appendRun(makeTurn(1, "first"));
    await svc.appendRun(makeTurn(1, "second"));
    const ro = new FileConversationJournalReadOnlyService({ journalDir: dir });
    const events = await ro.history("c1", {});
    const userMsgs = events.filter((e) => e.type === "user.message");
    expect(userMsgs).toHaveLength(1);
    expect(userMsgs[0].text).toBe("second");
  });

  it("writeRuns 全量覆盖", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jrnl-"));
    const file = nestedFile(dir, "c1");
    const svc = new FileConversationJournalService({ conversationId: "c1", filePath: file });
    await svc.open();
    await svc.appendRun(makeTurn(1, "old"));
    await svc.writeRuns([makeTurn(2, "new")]);
    const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
  });

  it("增量行协议：snapshot + append 折叠 = 全量快照语义（读侧等价）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jrnl-"));
    const file = nestedFile(dir, "inc");
    const svc = new FileConversationJournalService({ conversationId: "inc", filePath: file });
    await svc.open();
    await svc.appendRun({ seq: 1, messages: [{ role: "user", content: "hi" }], ts: "t1", appendRunMessages: () => {} });
    await svc.appendRunMessages(1, [{ role: "assistant", content: "hello" }]);
    await svc.appendRunMessages(1, [{ role: "tool", content: "ok", id: "t9" }]);
    const ro = new FileConversationJournalReadOnlyService({ journalDir: dir });
    const runs = await ro.readRuns("inc");
    expect(runs).toHaveLength(1);
    expect(runs[0]!.messages.map((m) => m.role)).toEqual(["user", "assistant", "tool"]);
    // 行数 = 快照 1 + 增量 2（每追加一行，而非全量重写）
    const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
    expect(lines).toHaveLength(3);
    expect(svc.lastSeq).toBe(1);
  });

  it("旧格式兼容：无 kind 的 {seq, run} 行按 snapshot 解释", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jrnl-"));
    const file = nestedFile(dir, "legacy");
    mkdirSync(dirname(file), { recursive: true });
    // 手写旧格式行（上一代 journal 产物）
    writeFileSync(file, `${JSON.stringify({ seq: 1, run: { seq: 1, messages: [{ role: "user", content: "旧" }], ts: "t" } })}\n`);
    const svc = new FileConversationJournalService({ conversationId: "legacy", filePath: file });
    await svc.open();
    expect(svc.lastSeq).toBe(1);
    await svc.appendRunMessages(1, [{ role: "assistant", content: "新" }]);
    const ro = new FileConversationJournalReadOnlyService({ journalDir: dir });
    const runs = await ro.readRuns("legacy");
    expect(runs[0]!.messages.map((m) => m.content)).toEqual(["旧", "新"]);
  });

  it("孤儿增量（无快照基线）合成空基线，事件边界完整", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jrnl-"));
    const file = nestedFile(dir, "orphan");
    const svc = new FileConversationJournalService({ conversationId: "orphan", filePath: file });
    await svc.open();
    await svc.appendRunMessages(2, [{ role: "user", content: "hi" }]);
    const ro = new FileConversationJournalReadOnlyService({ journalDir: dir });
    const events = await ro.history("orphan", {});
    const types = events.map((e) => e.type);
    expect(types[0]).toBe("run-start");
    expect(types).toContain("user.message");
    expect(types.at(-1)).toBe("run-end");
    expect(svc.lastSeq).toBe(2);
  });

  it("异步写队列：调用序 = 落盘序，flush 排空", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jrnl-"));
    const file = nestedFile(dir, "order");
    const svc = new FileConversationJournalService({ conversationId: "order", filePath: file });
    await svc.open();
    // 不逐个 await：并发入队，顺序仍须保证
    const p1 = svc.appendRun({ seq: 1, messages: [{ role: "user", content: "a" }], ts: "t", appendRunMessages: () => {} });
    const p2 = svc.appendRunMessages(1, [{ role: "assistant", content: "b" }]);
    const p3 = svc.appendRunMessages(1, [{ role: "assistant", content: "c" }]);
    await svc.flush();
    await Promise.all([p1, p2, p3]);
    const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
    const kinds = lines.map((l) => (JSON.parse(l) as { kind?: string }).kind);
    expect(kinds).toEqual(["snapshot", "append", "append"]);
    const ro = new FileConversationJournalReadOnlyService({ journalDir: dir });
    const runs = await ro.readRuns("order");
    expect(runs[0]!.messages.map((m) => m.content)).toEqual(["a", "b", "c"]);
  });

  it("readRuns 返回去重后的持久化 turns（同 seq 取最新，无运行时闭包）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jrnl-"));
    const file = nestedFile(dir, "c1");
    const svc = new FileConversationJournalService({ conversationId: "c1", filePath: file });
    await svc.open();
    await svc.appendRun(makeTurn(1, "first"));
    await svc.appendRun(makeTurn(1, "second"));
    await svc.appendRun(makeTurn(2, "third"));
    const ro = new FileConversationJournalReadOnlyService({ journalDir: dir });
    const turns = await ro.readRuns("c1");
    expect(turns.map((t) => t.seq)).toEqual([1, 2]);
    expect(turns[0]!.messages[0]!.content).toBe("second");
    expect("appendRunMessages" in turns[0]!).toBe(false);
  });
});
