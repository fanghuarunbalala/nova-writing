import { describe, expect, it } from "vitest";
import { CardProjection } from "../CardProjection.js";
import type { ProjectedEvent } from "../contract/events/index.js";

function evt(e: Partial<ProjectedEvent> & { type: ProjectedEvent["type"] }): ProjectedEvent {
	return { conversationId: "c1", ts: "t", ...e } as ProjectedEvent;
}

describe("CardProjection", () => {
	it("tool-recorded.started → proposal 卡（preview 标题/摘要），recorded → completed", () => {
		const p = new CardProjection();
		p.apply(
			evt({
				type: "tool-recorded.started",
				seq: 1,
				toolCallId: "t1",
				name: "CharacterWrite",
				preview: { action: "创建", object: "角色", title: "张三" },
			}),
		);
		expect(p.getCards()).toHaveLength(1);
		expect(p.getCards()[0]).toMatchObject({
			kind: "proposal",
			status: "in-progress",
			title: "角色：张三",
		});
		p.apply(
			evt({
				type: "tool-recorded.recorded",
				seq: 2,
				toolCallId: "t1",
				name: "CharacterWrite",
				outcome: "ok",
				preview: { action: "创建", object: "角色", title: "张三", summary: "角色已写入" },
			}),
		);
		expect(p.getCards()[0]).toMatchObject({ status: "completed", summary: "角色已写入" });
	});

	it("recorded outcome=failed → 卡片 failed", () => {
		const p = new CardProjection();
		p.apply(evt({ type: "tool-recorded.started", seq: 1, toolCallId: "t1", name: "CharacterWrite" }));
		p.apply(
			evt({ type: "tool-recorded.recorded", seq: 2, toolCallId: "t1", name: "CharacterWrite", outcome: "failed" }),
		);
		expect(p.getCards()[0].status).toBe("failed");
	});

	it("读类工具不产卡（started 无 preview.title 时兜底 titleOf）", () => {
		const p = new CardProjection();
		p.apply(evt({ type: "tool-recorded.started", seq: 1, toolCallId: "t1", name: "CharacterRead" }));
		expect(p.getCards()).toHaveLength(0);
		// 变更类工具无 preview.title → 域标题兜底
		p.apply(evt({ type: "tool-recorded.started", seq: 2, toolCallId: "t2", name: "ParagraphWrite" }));
		expect(p.getCards()[0]).toMatchObject({ title: "正文" });
	});

	it("recorded 无 started（重放范围截断）→ 不产卡也不抛错", () => {
		const p = new CardProjection();
		p.apply(
			evt({ type: "tool-recorded.recorded", seq: 9, toolCallId: "orphan", name: "CharacterWrite", outcome: "ok" }),
		);
		expect(p.getCards()).toHaveLength(0);
	});
});
