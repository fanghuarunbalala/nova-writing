/**
 * canonical 写工具名单：compose 激活期间被硬拒绝的 novel 域写/删工具（与 plan 语义一致）。
 * 工具定义 / 权限门 / 测试三方共用本常量；文件工具（Read/Glob/Write/Edit）不受此名单约束。
 */

/** canonical 写工具（10 个 Write/Edit + NovelDelete）；读工具不在列 */
export const CANONICAL_NOVEL_WRITES: ReadonlySet<string> = new Set([
	"OutlineWrite",
	"OutlineEdit",
	"CharacterWrite",
	"CharacterEdit",
	"LocationWrite",
	"LocationEdit",
	"ParagraphWrite",
	"ParagraphEdit",
	"PublicationWrite",
	"PublicationEdit",
	"NovelDelete",
]);

/**
 * 判断工具名是否为 canonical 写工具
 * @param toolName 工具名
 * @returns 是否在 canonical 写名单
 */
export function isCanonicalNovelWrite(toolName: string): boolean {
	return CANONICAL_NOVEL_WRITES.has(toolName);
}
