import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ComposeModeService } from "../ComposeModeService.js";
import { ComposeModeStateProvider } from "../ComposeModeState.js";
import type { OutputEvent, PersistedOutputEvent } from "../../contract/events/index.js";

/** 收集 sink 发出的事件（断言事件序） */
function makeSink() {
	const events: OutputEvent[] = [];
	return { events, sink: (e: OutputEvent) => events.push(e) };
}

describe("ComposeModeService", () => {
	let dir: string;
	let designRoot: string;
	let state: ComposeModeStateProvider;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "novel-compose-service-"));
		designRoot = join(dir, "workspace", ".novel", "design");
		state = new ComposeModeStateProvider();
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	function makeService(overrides: ConstructorParameters<typeof ComposeModeService>[0] = {}) {
		return new ComposeModeService({ composeState: state, designRoot, ...overrides });
	}

	it("begin：建 design 文件、事件序 compose.begin → mode.changed(compose)", async () => {
		const { events, sink } = makeSink();
		const service = makeService({ eventSink: sink });
		const details = await service.begin("c1");
		expect(details.phase).toBe("designing");
		expect(details.alreadyActive).toBeUndefined();
		expect(existsSync(details.designFilePath)).toBe(true);
		expect(events.map((e) => e.type)).toEqual(["compose.begin", "mode.changed"]);
		expect((events[1] as { mode: string }).mode).toBe("compose");
	});

	it("begin 幂等：已激活时 alreadyActive，不重建文件、不发事件", async () => {
		const { events, sink } = makeSink();
		const service = makeService({ eventSink: sink });
		const first = await service.begin("c1");
		writeFileSync(first.designFilePath, "draft v1", "utf8");
		const second = await service.begin("c1", "again");
		expect(second.alreadyActive).toBe(true);
		expect(second.designFilePath).toBe(first.designFilePath);
		expect(readFileSync(first.designFilePath, "utf8")).toBe("draft v1");
		expect(events).toHaveLength(2);
	});

	it("hasPriorDraft：旧草稿存在时标记 true 且不覆盖内容", async () => {
		const { events, sink } = makeSink();
		const service = makeService({ eventSink: sink });
		const path_ = service.designFilePathFor("c1");
		mkdirSync(designRoot, { recursive: true });
		writeFileSync(path_, "old draft", "utf8");
		await service.begin("c1");
		const begin = events[0] as { hasPriorDraft?: boolean };
		expect(begin.hasPriorDraft).toBe(true);
		expect(readFileSync(path_, "utf8")).toBe("old draft");
	});

	it("submit → pending + compose.submitted（带 approvalRequestId）；驳回回 designing", async () => {
		const { events, sink } = makeSink();
		const service = makeService({ eventSink: sink });
		await service.begin("c1");
		const snap = await service.submit("c1", "approval_r1");
		expect(snap.phase).toBe("pending");
		const submitted = events.find((e) => e.type === "compose.submitted") as {
			approvalRequestId?: string;
		};
		expect(submitted.approvalRequestId).toBe("approval_r1");
		await service.rejectOnDecision("c1");
		expect(state.snapshot("c1").phase).toBe("designing");
		expect(events.some((e) => e.type === "compose.rejected")).toBe(true);
	});

	it("rejectOnDecision 非 pending 时 no-op（不抛错不发事件）", async () => {
		const { events, sink } = makeSink();
		const service = makeService({ eventSink: sink });
		await service.rejectOnDecision("c1");
		expect(events).toHaveLength(0);
	});

	it("exit：applied + 归档 archive/ + digest + 恢复 preMode + settle", async () => {
		const recorder = { record: vi.fn(async () => {}) };
		const { events, sink } = makeSink();
		const service = makeService({ eventSink: sink, commitRecorder: recorder });
		const details = await service.begin("c1");
		writeFileSync(details.designFilePath, "final draft", "utf8");
		await service.submit("c1");
		await service.approveOnDecision("c1");
		const exited = await service.exit("c1");
		expect(exited.phase).toBe("applied");
		expect(state.snapshot("c1").mode).toBe("review");
		expect(state.snapshot("c1").designFilePath).toBeUndefined();
		// 归档：原文件移走、archive 下存在同名文件
		expect(existsSync(details.designFilePath)).toBe(false);
		expect(existsSync(join(designRoot, "archive", "c1.md"))).toBe(true);
		expect(recorder.record).toHaveBeenCalledTimes(1);
		const record = recorder.record.mock.calls[0]![0];
		expect(record.contentDigest).toMatch(/^[a-f0-9]{64}$/);
		// 事件尾序：compose.applied → mode.changed(review)
		const types = events.map((e) => e.type);
		expect(types.slice(-2)).toEqual(["compose.applied", "mode.changed"]);
		expect((events.at(-1) as { mode: string }).mode).toBe("review");
	});

	it("exit 非 active 时 no-op 安全网（审批决议晚到）", async () => {
		const { events, sink } = makeSink();
		const service = makeService({ eventSink: sink });
		const exited = await service.exit("c1");
		expect(exited.phase).toBe("idle");
		expect(events).toHaveLength(0);
	});

	it("discard：删 design 文件 + compose.discarded + mode.changed(preMode)", async () => {
		const { events, sink } = makeSink();
		const service = makeService({ eventSink: sink });
		const details = await service.begin("c1");
		await service.discard("c1");
		expect(existsSync(details.designFilePath)).toBe(false);
		expect(state.snapshot("c1").phase).toBe("discarded");
		const types = events.map((e) => e.type);
		expect(types.slice(-2)).toEqual(["compose.discarded", "mode.changed"]);
	});

	it("setMode：pending 时延迟，applyPendingModeTarget 决议后晋升", async () => {
		const { events, sink } = makeSink();
		const service = makeService({ eventSink: sink });
		await service.begin("c1");
		await service.submit("c1");
		await service.setMode("c1", "bypass");
		// pending 延迟：状态不变、无新 mode.changed
		expect(state.snapshot("c1").phase).toBe("pending");
		expect(events.filter((e) => e.type === "mode.changed" && (e as { mode: string }).mode === "bypass")).toHaveLength(0);
		await service.rejectOnDecision("c1");
		await service.applyPendingModeTarget("c1");
		// 驳回后回 designing，延迟目标晋升 → discard 路径落 bypass
		expect(state.snapshot("c1").mode).toBe("bypass");
		expect(state.snapshot("c1").active).toBe(false);
	});

	it("setMode 同值（非激活）：仍发 mode.changed（清 UI「待生效」chip；mode.pending 缺配对将永挂）", async () => {
		const { events, sink } = makeSink();
		const service = makeService({ eventSink: sink });
		expect(state.snapshot("c1").mode).toBe("review");
		await service.setMode("c1", "review");
		// 状态不变但事件照发：客户端 mode.pending → mode.changed 配对闭环
		expect(state.snapshot("c1").mode).toBe("review");
		const changed = events.filter((e) => e.type === "mode.changed");
		expect(changed).toHaveLength(1);
		expect((changed[0] as { mode: string }).mode).toBe("review");
	});

	it("setMode compose 目标走 begin；同 mode no-op 不发事件", async () => {
		const { events, sink } = makeSink();
		const service = makeService({ eventSink: sink });
		await service.setMode("c1", "compose");
		expect(state.snapshot("c1").phase).toBe("designing");
		await service.setMode("c1", "compose");
		expect(events).toHaveLength(2); // begin 幂等：不重复发
	});

	it("hydrateFromEvents：重放 begin/submitted/applied 恢复 applied + mode", async () => {
		const service = makeService();
		const events: PersistedOutputEvent[] = [
			{ type: "mode.changed", persist: true, mode: "bypass", conversationId: "c1", ts: "t1" },
			{
				type: "compose.begin",
				persist: true,
				phase: "designing",
				designFilePath: "/ws/.novel/design/c1.md",
				preComposeMode: "bypass",
				conversationId: "c1",
				ts: "t2",
			},
			{ type: "compose.submitted", persist: true, phase: "pending", conversationId: "c1", ts: "t3" },
			{
				type: "compose.applied",
				persist: true,
				phase: "applied",
				designFilePath: "/ws/.novel/design/c1.md",
				preComposeMode: "bypass",
				conversationId: "c1",
				ts: "t4",
			},
			{ type: "mode.changed", persist: true, mode: "bypass", conversationId: "c1", ts: "t5" },
		];
		await service.hydrateFromEvents("c1", events);
		expect(state.snapshot("c1")).toMatchObject({ phase: "applied", active: false, mode: "bypass" });
	});

	it("hydrateFromEvents：孤儿 compose（mode=compose 无 active 会话）回退 review", async () => {
		const service = makeService();
		const events: PersistedOutputEvent[] = [
			{ type: "mode.changed", persist: true, mode: "compose", conversationId: "c1", ts: "t1" },
		];
		await service.hydrateFromEvents("c1", events);
		expect(state.snapshot("c1")).toMatchObject({ active: false, mode: "review" });
	});

	it("hydrateFromEvents：active 但 design 文件丢失 → discard 回退 review", async () => {
		const service = makeService();
		const events: PersistedOutputEvent[] = [
			{
				type: "compose.begin",
				persist: true,
				phase: "designing",
				designFilePath: join(dir, "missing.md"),
				conversationId: "c1",
				ts: "t1",
			},
		];
		await service.hydrateFromEvents("c1", events);
		// discard 后 setMode(review) 重断言 idle（setMode 语义）
		expect(state.snapshot("c1")).toMatchObject({ active: false, phase: "idle", mode: "review" });
	});

	it("designFilePathFor：非法字符替换为 -", () => {
		const service = makeService();
		expect(service.designFilePathFor("a/b:c")).toBe(join(designRoot, "a-b-c.md"));
	});
});
