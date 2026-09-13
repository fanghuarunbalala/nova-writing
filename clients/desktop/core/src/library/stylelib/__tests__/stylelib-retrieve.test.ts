import { describe, expect, it } from "vitest";
import { fakeVector } from "../embed.js";
import { formatStylelibBlock, retrieve, type StylelibIndex } from "../retrieve.js";
import type { StylelibEntry } from "../types.js";

/** 造条目 */
function entry(id: string, text: string, styleTag: string, keywords: readonly string[]): StylelibEntry {
	return { id, paragraphId: `bk_test-p00000${id.slice(-1)}`, chapterNo: 1, text, styleTag, keywords };
}

/** 造索引（向量 = fakeVector(text)，条目与向量同源） */
function index(entries: readonly StylelibEntry[], withVectors = true): StylelibIndex {
	const vectors = new Float32Array(entries.length * 512);
	entries.forEach((e, i) => vectors.set(fakeVector(e.text), i * 512));
	return {
		doc: {
			schema: 1,
			bookId: "bk_test",
			builtAt: "2026-09-12T00:00:00Z",
			model: "test",
			stats: {
				candidates: 0,
				batches: 0,
				failedBatches: 0,
				kept: entries.length,
				dropped: { notSubstring: 0, tooLong: 0, tooShort: 0, badTag: 0, badGroup: 0, duplicate: 0 },
				tags: {},
				vectorless: !withVectors,
			},
			paragraphs: entries,
		},
		...(withVectors ? { vectors } : {}),
		mtimeMs: 0,
	};
}

const DIALOG = entry(
	"bk_test-sl-1",
	"“丑媳妇总得见公婆，你总不能在校门口站成望夫石吧？”蔡宗明一巴掌拍上他肩头。",
	"对话吐槽",
	["寝室闲聊", "互相伤害"],
);
const RAIN = entry(
	"bk_test-sl-2",
	"雨下了三天，青石板泛着水光，茶馆的灯在风里晃得像一句谎话。",
	"环境白描",
	["雨夜", "茶馆"],
);
const FIGHT = entry(
	"bk_test-sl-3",
	"刀出鞘的时候雨停了半拍，半拍之后雨声里多了一具尸体，桥上的人收伞入鞘。",
	"打斗",
	["对峙", "断桥"],
);

describe("stylelib 混合检索", () => {
	it("关键字路：要素词命中 text/keywords；反向整词强命中", () => {
		const hits = retrieve(index([DIALOG, RAIN, FIGHT]), "雨夜街道，茶馆的灯忽明忽暗", undefined, 2);
		expect(hits[0]?.entry.id).toBe("bk_test-sl-2");
		// 正向：查询词「茶馆」在 RAIN.text；反向：RAIN.keywords「雨夜」出现在查询里（×2）
		const dialogueHit = retrieve(index([DIALOG, RAIN]), "寝室闲聊，互相伤害的损友日常", undefined, 1);
		expect(dialogueHit[0]?.entry.id).toBe("bk_test-sl-1");
	});

	it("函数字 2-gram 不产生噪声命中", () => {
		// 「的了」「是在」等纯函数字 gram 被滤；无实质词 → 无命中
		expect(retrieve(index([RAIN]), "的了在了是在和与", undefined, 2)).toEqual([]);
	});

	it("RRF 融合：双路命中 > 单路高位", () => {
		// 查询同时贴近 RAIN（字面+向量）与 DIALOG（仅反向关键字）：RAIN 应居首
		const hits = retrieve(index([DIALOG, RAIN, FIGHT]), "雨夜茶馆门口的对话闲聊", fakeVector("雨下了三天青石板泛着水光茶馆的灯在风里晃"), 3);
		expect(hits[0]?.entry.id).toBe("bk_test-sl-2");
		expect(hits.length).toBe(3);
	});

	it("向量路：无字面重叠时语义近邻可召回", () => {
		const query = "茶馆灯影里的长街白描";
		const hits = retrieve(index([DIALOG, RAIN, FIGHT]), query, fakeVector(query), 1);
		expect(hits[0]?.entry.id).toBe("bk_test-sl-2");
	});

	it("无向量索引（vectorless 建库）：向量路跳过，关键字路照常", () => {
		const hits = retrieve(index([RAIN], false), "雨夜街道白描", undefined, 1);
		expect(hits[0]?.entry.id).toBe("bk_test-sl-2");
	});

	it("标签多样性：第 2 席让位异标签（全同则顺延）", () => {
		const same1 = entry("bk_test-sl-4", "第一段同标签文本内容长度足够二十字以上。", "对话吐槽", []);
		const same2 = entry("bk_test-sl-5", "第二段同标签不同文本内容长度足够二十字。", "对话吐槽", []);
		// 查询贴近 same1/same2（整词+gram 命中），同时「雨夜茶馆」反向命中 RAIN——
		// 分值序 same1 > same2 > RAIN，多样性第 2 席跳过 same2 取异标签 RAIN
		const hits = retrieve(index([same1, same2, RAIN]), "第一段同标签文本内容长度足够，但要雨夜茶馆的氛围", undefined, 2);
		expect(hits.map((h) => h.entry.styleTag)).toEqual(["对话吐槽", "环境白描"]);
	});

	it("标签过滤（onlyTags）：池内检索；异标签全滤为空；向量行号不因过滤错位", () => {
		const idx = index([DIALOG, RAIN, FIGHT]);
		// 查询贴近 DIALOG（寝室闲聊），但池只剩环境白描（RAIN）→ 池内命中 RAIN
		const hits = retrieve(idx, "寝室闲聊调侃，也要雨夜茶馆", undefined, 1, ["环境白描"]);
		expect(hits.map((h) => h.entry.id)).toEqual(["bk_test-sl-2"]);
		// 向量路：池过滤后行号仍指向原始矩阵行（RAIN 是第 2 行）
		const vec = fakeVector("雨下了三天青石板泛着水光茶馆的灯");
		const vecHits = retrieve(idx, "雨夜茶馆", vec, 1, ["环境白描"]);
		expect(vecHits[0]?.entry.id).toBe("bk_test-sl-2");
		// 全滤空：池空返回 []
		expect(retrieve(idx, "雨夜", undefined, 1, ["叙事推进"])).toEqual([]);
		// 不过滤 = 全量池
		expect(retrieve(idx, "雨夜茶馆", undefined, 3).length).toBeGreaterThan(0);
	});

	it("注入块渲染：含纪律声明 + 标签 + 关键字 + 原文", () => {
		const block = formatStylelibBlock(retrieve(index([DIALOG, RAIN]), "寝室闲聊的对话，配雨夜茶馆的氛围", undefined, 2));
		expect(block).toContain("仅示范段落节奏与叙述腔，禁止复用其内容词句");
		expect(block).toContain("示例·对话吐槽（寝室闲聊、互相伤害）：");
		expect(block).toContain(DIALOG.text);
		expect(formatStylelibBlock([])).toBe("");
	});
});
