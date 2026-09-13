import { describe, expect, it } from "vitest";
import type { ParagraphManifestEntry } from "../../LibraryService.js";
import { sampleGroups } from "../sample.js";

/** 造 manifest 条目（章序 → 批次序） */
function entry(chapterNo: number, seq: number): ParagraphManifestEntry {
	return {
		id: `bk_test-p${String(seq).padStart(6, "0")}`,
		chapterNo,
		chapterTitle: `第${chapterNo}章`,
		chars: 100,
		file: `paragraphs/bk_test-p${String(seq).padStart(6, "0")}.md`,
	};
}

describe("stylelib 候选抽样", () => {
	it("按章轮转均匀铺开（各章第 1 组先于任何章第 2 组）", () => {
		const manifest = [entry(1, 1), entry(1, 2), entry(2, 3), entry(2, 4), entry(3, 5)];
		const out = sampleGroups(manifest, 4);
		expect(out.map((e) => e.chapterNo)).toEqual([1, 2, 3, 1]);
	});

	it("目标 ≥ 全量时全取；不足则全取不重复", () => {
		const manifest = [entry(1, 1), entry(1, 2), entry(2, 3)];
		expect(sampleGroups(manifest, 100)).toHaveLength(3);
		const out = sampleGroups(manifest, 3);
		expect(new Set(out.map((e) => e.id)).size).toBe(3);
	});

	it("确定性：同输入同输出；空 manifest / target=0 返回空", () => {
		const manifest = Array.from({ length: 50 }, (_, i) => entry((i % 5) + 1, i + 1));
		expect(sampleGroups(manifest, 20)).toEqual(sampleGroups(manifest, 20));
		expect(sampleGroups([], 10)).toEqual([]);
		expect(sampleGroups(manifest, 0)).toEqual([]);
	});

	it("大书（多章多批）跨章分层", () => {
		const manifest: ParagraphManifestEntry[] = [];
		let seq = 0;
		for (let chapter = 1; chapter <= 10; chapter += 1) {
			for (let i = 0; i < 7; i += 1) {
				seq += 1;
				manifest.push(entry(chapter, seq));
			}
		}
		const out = sampleGroups(manifest, 25);
		expect(out).toHaveLength(25);
		const counts = new Map<number, number>();
		for (const e of out) counts.set(e.chapterNo, (counts.get(e.chapterNo) ?? 0) + 1);
		// 10 章各 1 组（10）后轮转第二轮（15）：首轮全章覆盖，且无章超过 3 组
		expect(counts.size).toBe(10);
		expect(Math.max(...counts.values()) - Math.min(...counts.values())).toBeLessThanOrEqual(1);
	});
});
