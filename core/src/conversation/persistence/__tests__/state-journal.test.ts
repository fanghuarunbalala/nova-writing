import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, appendFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileConversationStateJournalService } from "../FileConversationStateJournalService.js";
import { FileConversationJournalReadOnlyService } from "../FileConversationJournalReadOnlyService.js";
import type { PersistedOutputEvent } from "../../contract/events/index.js";

/** 造一条 mode.changed 状态事件 */
function modeChangedEvent(conversationId: string, mode: "review" | "bypass" | "compose"): PersistedOutputEvent {
	return {
		type: "mode.changed",
		persist: true,
		seq: 1,
		mode,
		conversationId,
		ts: "2026-08-14T00:00:00.000Z",
	};
}

describe("state journal sidecar", () => {
	let dir: string;
	let writeService: FileConversationStateJournalService;
	let readService: FileConversationJournalReadOnlyService;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "novel-state-journal-"));
		// 写侧 <storedir>/state.jsonl = 读侧 <journalDir>/<conversationId>/state.jsonl（storedir 布局对齐）
		writeService = new FileConversationStateJournalService({ filePath: join(dir, "c1", "state.jsonl") });
		readService = new FileConversationJournalReadOnlyService({ journalDir: dir });
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("append → readStateEvents 写读回环（落盘顺序）", async () => {
		await writeService.append(modeChangedEvent("c1", "compose"));
		await writeService.append({
			type: "compose.begin",
			persist: true,
			seq: 2,
			phase: "designing",
			designFilePath: "/ws/.novel/design/c1.md",
			conversationId: "c1",
			ts: "2026-08-14T00:00:01.000Z",
		});
		const events = await readService.readStateEvents("c1");
		expect(events).toHaveLength(2);
		expect(events[0]?.type).toBe("mode.changed");
		expect(events[1]?.type).toBe("compose.begin");
	});

	it("无 state.jsonl 时返回空序列", async () => {
		expect(await readService.readStateEvents("nope")).toEqual([]);
	});

	it("坏行/末尾半行容忍跳过", async () => {
		const stateFile = join(dir, "c1", "state.jsonl");
		await writeService.append(modeChangedEvent("c1", "compose"));
		appendFileSync(stateFile, "{broken json\n");
		appendFileSync(stateFile, `{"ts":"x","event":{"type":"user.message","persist":true}}\n`);
		appendFileSync(stateFile, `{"ts":"x","event":{`);
		const events = await readService.readStateEvents("c1");
		expect(events).toHaveLength(1);
		expect(events[0]?.type).toBe("mode.changed");
	});

	it("非白名单事件形状被跳过（防篡改行）", async () => {
		const stateFile = join(dir, "c1", "state.jsonl");
		await writeService.append(modeChangedEvent("c1", "compose"));
		appendFileSync(stateFile, `{"ts":"x","event":{"type":"compose.begin","persist":false,"conversationId":"c1"}}\n`);
		const events = await readService.readStateEvents("c1");
		expect(events).toHaveLength(1);
	});

	it("与 journal.jsonl 同目录并存互不干扰（readTurns 不受影响）", async () => {
		// journal.jsonl 放一条 turn 快照，state.jsonl 放一条状态事件
		mkdirSync(join(dir, "c1"), { recursive: true });
		const turn = { seq: 1, messages: [{ role: "user", content: "hi" }], ts: "2026-08-14T00:00:00.000Z" };
		appendFileSync(join(dir, "c1", "journal.jsonl"), `${JSON.stringify({ seq: 1, turn })}\n`);
		await writeService.append(modeChangedEvent("c1", "bypass"));
		const turns = await readService.readTurns("c1");
		expect(turns).toHaveLength(1);
		expect(turns[0]?.messages).toHaveLength(1);
		const events = await readService.readStateEvents("c1");
		expect(events).toHaveLength(1);
	});
});
