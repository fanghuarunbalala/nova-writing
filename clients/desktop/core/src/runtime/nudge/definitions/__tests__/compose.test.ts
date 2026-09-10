import { describe, it, expect, vi } from "vitest";
import { ComposeModeNudgePolicy } from "../compose.js";
import { ComposeModeStateProvider } from "../../../../conversation/compose/ComposeModeState.js";
import type { LoopContext } from "../../../loop/LoopContext.js";
import type { RunProgress } from "../../../loop/types.js";
import type { ProviderCall } from "../../../provider/types.js";

function mockLoop() {
	return { appendRunMessages: vi.fn() } as unknown as LoopContext;
}

function run(curTurn = 0): RunProgress {
	return { curTurn, maxTurn: 100, toolsLastTurn: new Map() };
}

function makeCall(): ProviderCall {
	return {
		system: "",
		tools: [],
		messages: [{ role: "user", content: "hi" }],
		sampling: { model: "gpt-5" },
	};
}

/** 取 appendRunMessages 最近一条 system 内容 */
function lastAppended(loop: ReturnType<typeof mockLoop>): string {
	const calls = (loop.appendRunMessages as ReturnType<typeof vi.fn>).mock.calls;
	return (calls.at(-1)![0] as Array<{ content: string }>)[0]!.content;
}

describe("ComposeModeNudgePolicy", () => {
	it("上升沿进入 designing → 发 compose_mode 全文（workspace 相对路径）", () => {
		const state = new ComposeModeStateProvider();
		const policy = new ComposeModeNudgePolicy(state, "main");
		state.enter("main", { designFilePath: "/ws/.novel/design/main.md", preComposeMode: "review" });
		const loop = mockLoop();
		expect(policy.persistentNudgeIfNeeded(loop, run())).toBe(true);
		const content = lastAppended(loop);
		expect(content).toContain("# 设计模式（Compose Mode）");
		expect(content).toContain("### Phase 5: 提交审批");
		expect(content).toContain("`.novel/design/main.md`");
		expect(content).not.toContain("/ws/"); // 不泄漏绝对路径
	});

	it("上升沿 + hasPriorDraft：full 后再附 reentry 提醒", () => {
		const state = new ComposeModeStateProvider();
		const policy = new ComposeModeNudgePolicy(state, "main");
		state.enter("main", { designFilePath: "/d.md", hasPriorDraft: true });
		const loop = mockLoop();
		expect(policy.persistentNudgeIfNeeded(loop, run())).toBe(true);
		const appended = (loop.appendRunMessages as ReturnType<typeof vi.fn>).mock.calls.map(
			(c) => (c[0] as Array<{ content: string }>)[0]!.content,
		);
		expect(appended).toHaveLength(2);
		expect(appended[1]).toContain("# 设计模式：已有旧草稿");
	});

	it("落点 pending（提交审批）→ 发 compose_mode_pending", () => {
		const state = new ComposeModeStateProvider();
		const policy = new ComposeModeNudgePolicy(state, "main");
		state.enter("main", { designFilePath: "/d.md" });
		policy.persistentNudgeIfNeeded(mockLoop(), run()); // 进入，latch=designing
		state.submit("main");
		const loop = mockLoop();
		expect(policy.persistentNudgeIfNeeded(loop, run())).toBe(true);
		expect(lastAppended(loop)).toContain("# 设计模式：等待审批");
	});

	it("落点 inactive（退出）→ 发 compose_mode_exit", () => {
		const state = new ComposeModeStateProvider();
		const policy = new ComposeModeNudgePolicy(state, "main");
		state.enter("main", { designFilePath: "/d.md" });
		policy.persistentNudgeIfNeeded(mockLoop(), run()); // 进入，latch=designing
		state.discard("main");
		const loop = mockLoop();
		expect(policy.persistentNudgeIfNeeded(loop, run())).toBe(true);
		expect(lastAppended(loop)).toContain("# 设计模式已结束");
	});

	it("驳回路径：pending → designing 落点重发 full（修订后重新提交）", () => {
		const state = new ComposeModeStateProvider();
		const policy = new ComposeModeNudgePolicy(state, "main");
		state.enter("main", { designFilePath: "/d.md" });
		policy.persistentNudgeIfNeeded(mockLoop(), run());
		state.submit("main");
		policy.persistentNudgeIfNeeded(mockLoop(), run()); // latch=pending
		state.reject("main");
		const loop = mockLoop();
		expect(policy.persistentNudgeIfNeeded(loop, run())).toBe(true);
		expect(lastAppended(loop)).toContain("# 设计模式（Compose Mode）");
	});

	it("构造时已 designing：latch seed，重启不重发上升沿", () => {
		const state = new ComposeModeStateProvider();
		state.enter("main", { designFilePath: "/d.md" }); // hydrate 后构造（顺序保证）
		const policy = new ComposeModeNudgePolicy(state, "main");
		const loop = mockLoop();
		expect(policy.persistentNudgeIfNeeded(loop, run())).toBe(false);
		expect(loop.appendRunMessages).not.toHaveBeenCalled();
	});

	it("稳态仍 compose：每 sparseEveryCalls 次 call 发一次 transient sparse（不落盘）", () => {
		const state = new ComposeModeStateProvider();
		state.enter("main", { designFilePath: "/d.md" });
		const policy = new ComposeModeNudgePolicy(state, "main");
		policy.persistentNudgeIfNeeded(mockLoop(), run()); // 进入，latch=designing
		const loop = mockLoop();
		const call = makeCall();
		const before = call.messages.length;
		let emitted = false;
		for (let i = 0; i < 5; i++) {
			emitted = policy.transientNudgeIfNeeded(loop, run(), call);
		}
		expect(emitted).toBe(true);
		expect(call.messages).toHaveLength(before + 1);
		expect((call.messages.at(-1) as { content: string }).content).toContain("# 设计模式（刷新）");
		expect(loop.appendRunMessages).not.toHaveBeenCalled(); // transient 不落盘
	});

	it("sparse 同 turn 至多一次：第 6 次 call（同 curTurn）不发，新 turn 再发", () => {
		const state = new ComposeModeStateProvider();
		state.enter("main", { designFilePath: "/d.md" });
		const policy = new ComposeModeNudgePolicy(state, "main");
		policy.persistentNudgeIfNeeded(mockLoop(), run());
		const loop = mockLoop();
		// turn 0：第 5 次发出
		let emitted = false;
		for (let i = 0; i < 5; i++) {
			emitted = policy.transientNudgeIfNeeded(loop, run(0), makeCall());
		}
		expect(emitted).toBe(true);
		// 同 turn 继续 4 次 call：计数重新累积（1..4）未到 5，不发
		for (let i = 0; i < 4; i++) {
			expect(policy.transientNudgeIfNeeded(loop, run(0), makeCall())).toBe(false);
		}
		// 新 turn（curTurn=1）：计数已 4，第一次 call 即到阈值并发出
		const call = makeCall();
		expect(policy.transientNudgeIfNeeded(loop, run(1), call)).toBe(true);
		expect((call.messages.at(-1) as { content: string }).content).toContain("# 设计模式（刷新）");
	});

	it("sparseEveryCalls 可配置（缺省 5 / 传入 2）", () => {
		const state = new ComposeModeStateProvider();
		state.enter("main", { designFilePath: "/d.md" });
		const policy = new ComposeModeNudgePolicy(state, "main", { sparseEveryCalls: 2 });
		policy.persistentNudgeIfNeeded(mockLoop(), run());
		const loop = mockLoop();
		expect(policy.transientNudgeIfNeeded(loop, run(), makeCall())).toBe(false);
		const call = makeCall();
		expect(policy.transientNudgeIfNeeded(loop, run(), call)).toBe(true);
	});

	it("inactive 稳态：persistent 与 transient 均不注入", () => {
		const state = new ComposeModeStateProvider();
		const policy = new ComposeModeNudgePolicy(state, "main");
		const loop = mockLoop();
		expect(policy.persistentNudgeIfNeeded(loop, run())).toBe(false);
		expect(policy.transientNudgeIfNeeded(loop, run(), makeCall())).toBe(false);
	});
});
