/**
 * FileConversationJournalReadOnlyService 分页语义（纯云端化 ⑤）：
 * - latest（最近 N run）/ before（seq < X 的最近 N run，向上翻页游标）尾部页语义；
 * - fromSeq+limit 头部前向语义回归不变；
 * - 折叠缓存 stat 失效：追加新 run 后读取立即可见。
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileConversationJournalService } from "../FileConversationJournalService.js";
import { FileConversationJournalReadOnlyService } from "../FileConversationJournalReadOnlyService.js";
import type { LLMessage } from "../../../runtime/provider/types.js";
import type { RunContext } from "../../../runtime/loop/types.js";

const user = (content: string): LLMessage => ({ role: "user", content } as unknown as LLMessage);
const run = (seq: number, text: string): RunContext => ({ seq, messages: [user(text)] } as unknown as RunContext);

describe("journal 读侧分页（latest / before）", () => {
  it("latest=最近 N run；before=seq<X 的最近 N run；fromSeq 前向语义不变", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nova-rh-"));
    try {
      const writer = new FileConversationJournalService({ conversationId: "c1", filePath: join(dir, "c1", "journal.jsonl") });
      await writer.open();
      for (let i = 1; i <= 10; i += 1) await writer.appendRun(run(i, `第 ${i} 轮`));
      const reader = new FileConversationJournalReadOnlyService({ journalDir: dir });
      const texts = async (opts: { fromSeq?: number; limit?: number; before?: number; latest?: boolean }) => {
        const events = await reader.history("c1", opts);
        return events.filter((e) => e.type === "user.message").map((e) => (e as { text: string }).text);
      };
      // 最近 3 run
      expect(await texts({ latest: true, limit: 3 })).toEqual(["第 8 轮", "第 9 轮", "第 10 轮"]);
      // 向上翻页：seq < 8 的最近 2 run
      expect(await texts({ before: 8, limit: 2 })).toEqual(["第 6 轮", "第 7 轮"]);
      // 翻尽边界：seq < 2 的最近 5 → 只剩第 1 轮
      expect(await texts({ before: 2, limit: 5 })).toEqual(["第 1 轮"]);
      // 前向（旧语义回归）：fromSeq=2 取前 3
      expect(await texts({ fromSeq: 2, limit: 3 })).toEqual(["第 2 轮", "第 3 轮", "第 4 轮"]);
      // 无参数全量
      expect((await texts({}))).toHaveLength(10);
      // 投影读取同语义
      const projected = await reader.projectedHistory("c1", { latest: true, limit: 1 });
      expect(projected.some((e) => e.type === "user.message")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("折叠缓存 stat 失效：追加新 run 后（新 reader 实例）读取立即可见", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nova-rh-"));
    try {
      const writer = new FileConversationJournalService({ conversationId: "c2", filePath: join(dir, "c2", "journal.jsonl") });
      await writer.open();
      await writer.appendRun(run(1, "旧"));
      // 读一次（填充模块级折叠缓存）
      const first = new FileConversationJournalReadOnlyService({ journalDir: dir });
      const before = await first.history("c2", { latest: true, limit: 5 });
      expect(before.filter((e) => e.type === "user.message")).toHaveLength(1);
      // 追加（size/mtime 变化 → 缓存失效）
      await writer.appendRun(run(2, "新"));
      const second = new FileConversationJournalReadOnlyService({ journalDir: dir });
      const after = await second.history("c2", { latest: true, limit: 5 });
      expect(after.filter((e) => e.type === "user.message")).toHaveLength(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
