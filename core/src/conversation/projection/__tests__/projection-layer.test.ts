import { describe, expect, it } from "vitest";
import { ProjectionLayer } from "../ProjectionLayer.js";
import type { LoopEvent } from "../../../runtime/loop/types.js";

/** 构造完整事件（缺省 conversationId/ts） */
function evt(e: Partial<LoopEvent> & { type: LoopEvent["type"] }): LoopEvent {
	return { conversationId: "c1", ts: "2026-08-14T10:00:00.000Z", ...e } as LoopEvent;
}

/** 工具调用对（request + response） */
function toolPair(overrides?: { name?: string; args?: string; result?: string; error?: string }) {
	const request = evt({
		type: "tool-call-request",
		persist: true,
		seq: 1,
		toolCallId: "t1",
		name: overrides?.name ?? "UnregisteredTool",
		args: overrides?.args ?? '{"a":1}',
		ts: "2026-08-14T10:00:00.000Z",
	});
	const response = evt({
		type: "tool-call-response",
		persist: true,
		seq: 2,
		toolCallId: "t1",
		...(overrides?.result !== undefined ? { result: overrides.result } : {}),
		...(overrides?.error !== undefined ? { error: overrides.error } : {}),
		ts: "2026-08-14T10:00:00.150Z",
	});
	return { request, response };
}

describe("ProjectionLayer", () => {
	it("request → started（携带 preview），response 配对 → recorded（outcome/durationMs/preview）", () => {
		const layer = new ProjectionLayer();
		const { request, response } = toolPair();
		const started = layer.project(request);
		expect(started).toMatchObject({
			type: "tool-recorded.started",
			seq: 1,
			toolCallId: "t1",
			name: "UnregisteredTool",
			preview: { summary: '{"a":1}' },
		});
		const recorded = layer.project(response);
		expect(recorded).toMatchObject({
			type: "tool-recorded.recorded",
			seq: 2,
			toolCallId: "t1",
			name: "UnregisteredTool",
			outcome: "ok",
			durationMs: 150,
			preview: { summary: '{"a":1}（执行完成）' },
		});
	});

	it("response 有 error → outcome=failed + 截断 error + 失败 preview", () => {
		const layer = new ProjectionLayer();
		const { request, response } = toolPair({ error: "x".repeat(300) });
		layer.project(request);
		const recorded = layer.project(response);
		expect(recorded).toMatchObject({
			type: "tool-recorded.recorded",
			outcome: "failed",
			preview: { summary: '{"a":1}（执行失败）' },
		});
		expect((recorded as { error?: string }).error).toHaveLength(201);
	});

	it("response 无 request（未配对）→ 仍产出 recorded，name=unknown、无 preview/durationMs", () => {
		const layer = new ProjectionLayer();
		const recorded = layer.project(
			evt({ type: "tool-call-response", persist: true, seq: 9, toolCallId: "orphan", result: "ok" }),
		);
		expect(recorded).toMatchObject({
			type: "tool-recorded.recorded",
			name: "unknown",
			outcome: "ok",
			seq: 9,
		});
		expect(recorded).not.toHaveProperty("preview");
		expect(recorded).not.toHaveProperty("durationMs");
	});

	it("turn-end 丢弃未配对 pending（其后 response 按 unknown 处理）", () => {
		const layer = new ProjectionLayer();
		const { request, response } = toolPair();
		layer.project(request);
		const turnEnd = layer.project(evt({ type: "turn-end", persist: true, seq: 3, turnSeq: 1 }));
		expect(turnEnd).toMatchObject({ type: "turn-end" });
		const recorded = layer.project(response);
		expect(recorded).toMatchObject({ type: "tool-recorded.recorded", name: "unknown" });
	});

	it("preview 抛错 → 回退默认预览，投影流不断裂", () => {
		const layer = new ProjectionLayer({
			resolvePreview: {
				resolvePreview: () => () => {
					throw new Error("boom");
				},
			},
		});
		const { request, response } = toolPair({ args: "x" });
		const started = layer.project(request);
		expect(started).toMatchObject({ type: "tool-recorded.started", preview: { summary: "x" } });
		const recorded = layer.project(response);
		expect(recorded).toMatchObject({ preview: { summary: "x（执行完成）" } });
	});

	it("preview 返回非法值 → 回退默认预览", () => {
		const layer = new ProjectionLayer({
			resolvePreview: {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				resolvePreview: () => (() => "not-an-object") as any,
			},
		});
		const { request } = toolPair({ args: "x" });
		expect(layer.project(request)).toMatchObject({ preview: { summary: "x" } });
	});

	it("其余事件原样透传且保序", () => {
		const layer = new ProjectionLayer();
		const events = [
			evt({ type: "turn-start", persist: true, seq: 1, turnSeq: 1 }),
			evt({ type: "user.message", persist: true, seq: 2, text: "hi" }),
			evt({ type: "assistant.delta", text: "你" }),
			evt({ type: "assistant.message", persist: true, seq: 4, text: "你好" }),
			evt({ type: "turn-end", persist: true, seq: 5, turnSeq: 1 }),
			evt({ type: "compacted", persist: true, seq: 6 }),
			evt({ type: "clear", persist: true, seq: 7 }),
			evt({ type: "retry-request", persist: true, seq: 8 }),
		];
		const projected = events.map((e) => layer.project(e));
		expect(projected).toEqual(events);
	});

	it("确定性：同一序列重投影两次深等", () => {
		const seq = [
			evt({ type: "turn-start", persist: true, seq: 1, turnSeq: 1 }),
			evt({ type: "user.message", persist: true, seq: 1, text: "hi" }),
			evt({ type: "tool-call-request", persist: true, seq: 1, toolCallId: "t1", name: "ParagraphWrite", args: '{"storyUnitId":"ch1"}' }),
			evt({ type: "tool-call-response", persist: true, seq: 2, toolCallId: "t1", result: "ok" }),
			evt({ type: "assistant.delta", text: "正文" }),
			evt({ type: "assistant.message", persist: true, seq: 3, text: "正文" }),
			evt({ type: "turn-end", persist: true, seq: 3, turnSeq: 1 }),
		];
		const layer1 = new ProjectionLayer();
		const layer2 = new ProjectionLayer();
		const run1 = seq.map((e) => layer1.project(e));
		const run2 = seq.map((e) => layer2.project(e));
		expect(run1).toEqual(run2);
		// 关键投影字段抽查：started/recorded 成对且字段确定
		expect(run1.filter((e) => e?.type === "tool-recorded.started")).toHaveLength(1);
		expect(run1.filter((e) => e?.type === "tool-recorded.recorded")).toHaveLength(1);
		expect(run1.find((e) => e?.type === "tool-recorded.recorded")).toMatchObject({ name: "ParagraphWrite", outcome: "ok", durationMs: 0 });
	});
});
