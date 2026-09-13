/**
 * ```novel 正文块提取（case 16 正文创作评测与 human-review 共用）：
 * agent 按 prompt 规范把正文落在 ```novel 代码块里，最终回复可能夹带解释文字，
 * 评测取块内正文而非整段 final。无块返回 null（判失败路径），多块取第一个（首个即正文）。
 */
export function extractNovelBlocks(text: string): string[] {
	return [...text.matchAll(/```novel[^\n]*\n([\s\S]*?)```/g)].map((m) => m[1].trim());
}

/** 取首个 ```novel 块正文；无块返回 null */
export function extractNovelText(text: string): string | null {
	const blocks = extractNovelBlocks(text);
	return blocks.length === 0 ? null : blocks[0];
}
