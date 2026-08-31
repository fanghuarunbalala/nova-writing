/**
 * 记忆种子构建器（PRD memory-两层记忆 §6.2/6.3 评测）：产出与 MemoryStore 落盘
 * 格式严格一致的 seed.files 条目（frontmatter 主题文件 + MEMORY.md 索引行），
 * 防手写格式漂移——格式合法性由 src/memory-e2e.test.ts 写入路径落盘自测锁死。
 */

/** 记忆条目类型 */
export type MemorySeedType = "author" | "feedback" | "project" | "reference";

/** memoryTopic 种子选项 */
export interface MemoryTopicSeed {
	readonly name: string;
	readonly type: MemorySeedType;
	readonly description: string;
	/** 正文（三段式建议；缺省按 description 生成最小三段式） */
	readonly content?: string;
	readonly source?: string;
	readonly status?: "active" | "superseded";
	readonly supersededBy?: string;
}

/** 主题文件内容（与 MemoryStore.serializeTopic 同构） */
export function memoryTopicFile(seed: MemoryTopicSeed): string {
	const ts = "2026-08-29T10:00:00.000Z";
	const body =
		seed.content ??
		`## 规则/事实\n\n${seed.description}\n\n## Why\n\n作者在会话中明确要求。\n\n## How to apply\n\n相关场景生成前先读本条并遵守。`;
	return [
		"---",
		`name: ${seed.name}`,
		`type: ${seed.type}`,
		`description: ${seed.description}`,
		`created: ${ts}`,
		`modified: ${ts}`,
		`source: ${seed.source ?? "eval_seed#1"}`,
		`status: ${seed.status ?? "active"}`,
		...(seed.supersededBy !== undefined ? [`superseded-by: ${seed.supersededBy}`] : []),
		"---",
		"",
		body,
		"",
	].join("\n");
}

/** 索引行（与 renderIndexLine 同构） */
export function memoryIndexLine(seed: Pick<MemoryTopicSeed, "name" | "type" | "description">): string {
	return `- ${seed.name} — ${seed.description}（${seed.type}）`;
}

/** 记忆种子集 → seed.files 片段（active 条目进索引；superseded 不进） */
export function memorySeedFiles(seeds: readonly MemoryTopicSeed[]): Record<string, string> {
	const files: Record<string, string> = {};
	for (const seed of seeds) {
		files[`memory/${seed.name}.md`] = memoryTopicFile(seed);
	}
	const active = seeds.filter((s) => (s.status ?? "active") === "active");
	files["memory/MEMORY.md"] =
		active.length === 0 ? "" : `${active.map(memoryIndexLine).join("\n")}\n`;
	return files;
}
