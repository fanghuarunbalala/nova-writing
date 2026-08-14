import { describe, expect, it } from "vitest";
import { CardProjection } from "../CardProjection.js";
import type { LoopEvent } from "../../runtime/loop/types.js";

function evt(e: Partial<LoopEvent> & { type: LoopEvent["type"] }): LoopEvent {
	return { conversationId: "c1", ts: "t", ...e } as LoopEvent;
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
