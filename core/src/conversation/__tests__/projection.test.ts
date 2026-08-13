import { describe, expect, it } from "vitest";
import { CardProjection } from "../CardProjection.js";
import { ApprovalProjection } from "../ApprovalProjection.js";
import type { OutputEvent } from "../contract/events/index.js";

function evt(e: Partial<OutputEvent> & { type: OutputEvent["type"] }): OutputEvent {
	return { conversationId: "c1", ts: "t", ...e } as OutputEvent;
}

describe("CardProjection", () => {
	it("tool-call-request → proposal 卡，response → completed", () => {
		const p = new CardProjection();
		p.apply(evt({ type: "tool-call-request", persist: true, seq: 1, toolCallId: "t1", name: "CharacterWrite", args: '{"name":"张三"}' }));
		expect(p.getCards()).toHaveLength(1);
		expect(p.getCards()[0].kind).toBe("proposal");
		expect(p.getCards()[0].status).toBe("in-progress");
		p.apply(evt({ type: "tool-call-response", persist: true, seq: 2, toolCallId: "t1", result: "ok" }));
		expect(p.getCards()[0].status).toBe("completed");
	});

	it("读类工具不产卡", () => {
		const p = new CardProjection();
		p.apply(evt({ type: "tool-call-request", persist: true, seq: 1, toolCallId: "t1", name: "CharacterRead", args: "{}" }));
		expect(p.getCards()).toHaveLength(0);
	});
});

describe("ApprovalProjection", () => {
	it("approval.request → pending，resolved → 对应状态", () => {
		const p = new ApprovalProjection();
		p.apply(evt({ type: "approval.request", persist: false, requestId: "r1", toolName: "CharacterWrite", args: "{}" }));
		expect(p.getPending()).toHaveLength(1);
		p.apply(evt({ type: "approval.resolved", persist: false, requestId: "r1", decision: "approved" }));
		expect(p.getPending()).toHaveLength(0);
		expect(p.getAll()[0].status).toBe("approved");
	});
});
