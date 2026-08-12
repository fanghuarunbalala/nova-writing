import { describe, expect, it } from "vitest";
import type {
	CharacterId,
	LocationId,
	ParagraphId,
	PublicationChapterId,
	PublicationVolumeId,
	StoryUnitId,
} from "../model/id.js";
import type { OrderKey } from "../model/outline.js";
import type { Character, Location, Paragraph, StoryUnit } from "../model/index.js";
import type { NovelQuery } from "../contract/query.js";
import type { NovelMutation } from "../contract/mutation.js";
import type { NovelChangeEntity, NovelChangeEvent } from "../contract/event.js";

/** branded 身份构造辅助（测试用） */
const brand = <T>(s: string): T => s as unknown as T;
const su = (s: string) => brand<StoryUnitId>(s);
const ci = (s: string) => brand<CharacterId>(s);
const li = (s: string) => brand<LocationId>(s);
const pi = (s: string) => brand<ParagraphId>(s);
const vi = (s: string) => brand<PublicationVolumeId>(s);
const chi = (s: string) => brand<PublicationChapterId>(s);
const ok = (s: string) => brand<OrderKey>(s);

/** 覆盖全部 NovelMutation op 的 fixture */
const MUTATION_FIXTURES: NovelMutation[] = [
	{ op: "outline.storyUnit.create", orderKey: ok("0000"), title: "序章" },
	{ op: "outline.storyUnit.update", storyUnitId: su("su-1"), patch: { title: "新标题" } },
	{ op: "outline.storyUnit.move", storyUnitId: su("su-1"), parentId: su("su-0"), orderKey: ok("0001") },
	{ op: "outline.storyUnit.delete", storyUnitId: su("su-1") },
	{ op: "character.create", input: { name: "主角", aliases: ["阿主"] } },
	{ op: "character.update", characterId: ci("c-1"), patch: { summary: "..." } },
	{ op: "character.delete", characterId: ci("c-1") },
	{ op: "location.create", input: { name: "王城" } },
	{ op: "location.update", locationId: li("l-1"), patch: { name: "皇城" } },
	{ op: "location.delete", locationId: li("l-1") },
	{ op: "paragraph.insert", storyUnitId: su("su-1"), orderKey: ok("0000"), text: "正文" },
	{ op: "paragraph.update", paragraphId: pi("p-1"), text: "改后正文" },
	{ op: "paragraph.delete", paragraphId: pi("p-1") },
	{ op: "publication.volume.create", orderKey: ok("0000"), title: "第一卷" },
	{ op: "publication.volume.update", volumeId: vi("v-1"), patch: { title: "卷一" } },
	{ op: "publication.volume.delete", volumeId: vi("v-1") },
	{ op: "publication.chapter.create", volumeId: vi("v-1"), orderKey: ok("0000"), title: "第一章" },
	{ op: "publication.chapter.update", chapterId: chi("ch-1"), patch: { title: "第一章（改）" } },
	{ op: "publication.chapter.delete", chapterId: chi("ch-1") },
];

const EXPECTED_MUTATION_OPS = [
	"character.create",
	"character.delete",
	"character.update",
	"location.create",
	"location.delete",
	"location.update",
	"outline.storyUnit.create",
	"outline.storyUnit.delete",
	"outline.storyUnit.move",
	"outline.storyUnit.update",
	"paragraph.delete",
	"paragraph.insert",
	"paragraph.update",
	"publication.chapter.create",
	"publication.chapter.delete",
	"publication.chapter.update",
	"publication.volume.create",
	"publication.volume.delete",
	"publication.volume.update",
].sort();

/** 穷举 switch：op → 实体类别（TS 编译期强制穷举，防漏 op） */
function entityOf(m: NovelMutation): NovelChangeEntity {
	switch (m.op) {
		case "outline.storyUnit.create":
		case "outline.storyUnit.update":
		case "outline.storyUnit.move":
		case "outline.storyUnit.delete":
			return "outline";
		case "character.create":
		case "character.update":
		case "character.delete":
			return "character";
		case "location.create":
		case "location.update":
		case "location.delete":
			return "location";
		case "paragraph.insert":
		case "paragraph.update":
		case "paragraph.delete":
			return "paragraph";
		case "publication.volume.create":
		case "publication.volume.update":
		case "publication.volume.delete":
		case "publication.chapter.create":
		case "publication.chapter.update":
		case "publication.chapter.delete":
			return "publication";
	}
}

describe("NovelMutation 判别联合", () => {
	it("op 集合覆盖全部预期操作（增删操作会在此被捕获）", () => {
		const ops = MUTATION_FIXTURES.map((m) => m.op).sort();
		expect(ops).toEqual(EXPECTED_MUTATION_OPS);
	});

	it("穷举 switch：每个 op 都能映射到实体类别", () => {
		for (const m of MUTATION_FIXTURES) {
			expect(entityOf(m)).toBeTruthy();
		}
		// outline 变更应归 outline，character 归 character ...
		expect(entityOf(MUTATION_FIXTURES[0])).toBe("outline");
		expect(entityOf(MUTATION_FIXTURES[4])).toBe("character");
		expect(entityOf(MUTATION_FIXTURES[10])).toBe("paragraph");
		expect(entityOf(MUTATION_FIXTURES[13])).toBe("publication");
	});
});

describe("NovelQuery 判别联合", () => {
	const QUERY_FIXTURES: NovelQuery[] = [
		{ op: "overview.get" },
		{ op: "outline.get" },
		{ op: "outline.storyUnit.get", storyUnitId: su("su-1") },
		{ op: "characters.list" },
		{ op: "characters.get", characterId: ci("c-1") },
		{ op: "locations.list" },
		{ op: "locations.get", locationId: li("l-1") },
		{ op: "paragraphs.list", storyUnitId: su("su-1") },
		{ op: "paragraph.get", paragraphId: pi("p-1") },
		{ op: "publication.get" },
	];

	const EXPECTED_QUERY_OPS = [
		"characters.get",
		"characters.list",
		"locations.get",
		"locations.list",
		"outline.get",
		"outline.storyUnit.get",
		"overview.get",
		"paragraph.get",
		"paragraphs.list",
		"publication.get",
	].sort();

	it("op 集合覆盖全部预期查询", () => {
		const ops = QUERY_FIXTURES.map((q) => q.op).sort();
		expect(ops).toEqual(EXPECTED_QUERY_OPS);
	});

	it("每个查询都有唯一 op 判别", () => {
		const ops = QUERY_FIXTURES.map((q) => q.op);
		expect(new Set(ops).size).toBe(ops.length);
	});
});

describe("model 值对象", () => {
	it("Character 构造与读取", () => {
		const c: Character = {
			id: ci("c-1"),
			name: "主角",
			aliases: ["阿主"],
			summary: "出身平民",
			entityVersion: 1,
			createdAt: "2026-08-12T00:00:00.000Z",
			updatedAt: "2026-08-12T00:00:00.000Z",
		};
		expect(c.name).toBe("主角");
		expect(c.entityVersion).toBe(1);
	});

	it("Location 构造与读取", () => {
		const l: Location = {
			id: li("l-1"),
			name: "王城",
			aliases: [],
			entityVersion: 1,
			createdAt: "2026-08-12T00:00:00.000Z",
			updatedAt: "2026-08-12T00:00:00.000Z",
		};
		expect(l.name).toBe("王城");
	});

	it("Paragraph 不可变值对象（属于 story unit + orderKey）", () => {
		const p: Paragraph = { id: pi("p-1"), storyUnitId: su("su-1"), orderKey: ok("0000"), text: "正文" };
		expect(p.storyUnitId).toBe("su-1");
		expect(p.text).toBe("正文");
	});

	it("StoryUnit 层级 + 状态字段", () => {
		const unit: StoryUnit = {
			id: su("su-1"),
			outlineId: brand("out-1"),
			parentId: su("su-0"),
			orderKey: ok("0001"),
			title: "序章",
			scope: "scene",
			planningStatus: "ready",
			realizationStatus: "in-progress",
		};
		expect(unit.scope).toBe("scene");
		expect(unit.realizationStatus).toBe("in-progress");
	});
});

describe("NovelChangeEvent", () => {
	it("携带 op / entity / id / version", () => {
		const evt: NovelChangeEvent = {
			type: "novel.changed",
			op: "character.update",
			entity: "character",
			id: "c-1",
			version: 2,
			ts: "2026-08-12T00:00:00.000Z",
		};
		expect(evt.type).toBe("novel.changed");
		expect(evt.entity).toBe("character");
	});
});
