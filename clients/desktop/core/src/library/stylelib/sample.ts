/**
 * 候选段落组分层抽样（PRD F1）：manifest 行自带 chapterNo，按章轮转各取下一组
 * 直到凑满目标——跨章均匀铺开、确定性无随机（重建可复现）。754 章级全书每章
 * 约 1-2 组，天然分层。
 */
import type { ParagraphManifestEntry } from "../LibraryService.js";
import { CANDIDATE_TARGET } from "./types.js";

/**
 * 抽样候选段落组
 * @param manifest 全书分段索引（全书顺序）
 * @param target 目标组数（缺省 CANDIDATE_TARGET；不足则全取）
 * @returns 候选组（章序升序轮转产出；确定性）
 */
export function sampleGroups(
	manifest: readonly ParagraphManifestEntry[],
	target: number = CANDIDATE_TARGET,
): ParagraphManifestEntry[] {
	if (manifest.length === 0 || target <= 0) return [];
	// 按章分组（章内保持 manifest 顺序）
	const byChapter = new Map<number, ParagraphManifestEntry[]>();
	for (const entry of manifest) {
		const list = byChapter.get(entry.chapterNo);
		if (list === undefined) {
			byChapter.set(entry.chapterNo, [entry]);
		} else {
			list.push(entry);
		}
	}
	// 章序升序轮转：各章第 1 组 → 各章第 2 组 → …（凑满 target 或取尽）
	const chapters = [...byChapter.entries()].sort((a, b) => a[0] - b[0]);
	const cursors = chapters.map(() => 0);
	const out: ParagraphManifestEntry[] = [];
	let advanced = true;
	while (out.length < target && advanced) {
		advanced = false;
		for (let c = 0; c < chapters.length && out.length < target; c++) {
			const list = chapters[c]?.[1];
			if (list === undefined) continue;
			const idx = cursors[c];
			if (idx === undefined || idx >= list.length) continue;
			const entry = list[idx];
			if (entry !== undefined) out.push(entry);
			cursors[c] = idx + 1;
			advanced = true;
		}
	}
	return out;
}
