/**
 * 书库存储布局（唯一事实源；LibraryService 之外不得自行拼接书库路径）。
 * 布局（PRD library-完本解构 F3；每书一库 book.db——store 为单书模型，
 * 查询天然按书隔离）：
 *
 *   <libraryRoot>/
 *     <bookId>/
 *       book.meta.json        # 书名/源文件/统计/状态/时间戳
 *       book.db               # 该书 novel 域库（同模型；卷章发布骨架 + Agent 智能解构）
 *       source/<原始文件名>    # UTF-8 归一原文
 *       paragraphs/<id>.md    # 正文分批（每批输入，不入库）
 *       paragraphs/manifest.jsonl
 *       analysis/style.md / excerpts.md
 */
import { join } from "node:path";

/** bookId 生成计数器 */
let bookCounter = 0;

/**
 * 生成 bookId（host 风格：bk_<base36 计数><base36 时间尾>；全局唯一）
 * @returns bookId
 */
export function nextBookId(): string {
	bookCounter += 1;
	return `bk_${bookCounter.toString(36)}${Date.now().toString(36).slice(-6)}`;
}

/**
 * 校验 bookId 合法性（防路径逃逸：仅字母数字与下划线，字母开头）
 * @param bookId 待校验 id
 * @returns 是否合法
 */
export function isValidBookId(bookId: string): boolean {
	return /^[A-Za-z0-9_]{1,64}$/.test(bookId);
}

/**
 * 书目录（<libraryRoot>/<bookId>）
 * @param libraryRoot 书库根
 * @param bookId 书 id
 * @returns 书目录绝对/相对路径
 */
export function bookDir(libraryRoot: string, bookId: string): string {
	return join(libraryRoot, bookId);
}

/**
 * 书库 db 路径（<bookDir>/book.db）
 * @param libraryRoot 书库根
 * @param bookId 书 id
 * @returns db 文件路径
 */
export function bookDbPath(libraryRoot: string, bookId: string): string {
	return join(bookDir(libraryRoot, bookId), "book.db");
}

/**
 * 书元数据文件路径（<bookDir>/book.meta.json）
 * @param libraryRoot 书库根
 * @param bookId 书 id
 * @returns meta 文件路径
 */
export function bookMetaPath(libraryRoot: string, bookId: string): string {
	return join(bookDir(libraryRoot, bookId), "book.meta.json");
}

/**
 * 原文目录（<bookDir>/source）
 * @param libraryRoot 书库根
 * @param bookId 书 id
 * @returns source 目录路径
 */
export function bookSourceDir(libraryRoot: string, bookId: string): string {
	return join(bookDir(libraryRoot, bookId), "source");
}

/**
 * 分段目录（<bookDir>/paragraphs）
 * @param libraryRoot 书库根
 * @param bookId 书 id
 * @returns paragraphs 目录路径
 */
export function bookParagraphsDir(libraryRoot: string, bookId: string): string {
	return join(bookDir(libraryRoot, bookId), "paragraphs");
}

/**
 * 分段文件路径（<bookDir>/paragraphs/<paragraphId>.md）
 * @param libraryRoot 书库根
 * @param bookId 书 id
 * @param paragraphId 分段 id
 * @returns 分段文件路径
 */
export function paragraphFilePath(
	libraryRoot: string,
	bookId: string,
	paragraphId: string,
): string {
	return join(bookParagraphsDir(libraryRoot, bookId), `${paragraphId}.md`);
}

/**
 * 分段索引路径（<bookDir>/paragraphs/manifest.jsonl）
 * @param libraryRoot 书库根
 * @param bookId 书 id
 * @returns manifest 文件路径
 */
export function bookManifestPath(libraryRoot: string, bookId: string): string {
	return join(bookParagraphsDir(libraryRoot, bookId), "manifest.jsonl");
}

/**
 * 分析产物路径（style / excerpt → analysis/style.md、analysis/excerpts.md）
 * @param libraryRoot 书库根
 * @param bookId 书 id
 * @param which 产物类型（style=全局风格 md / excerpt=特色原文）
 * @returns 产物文件路径
 */
export function analysisFilePath(
	libraryRoot: string,
	bookId: string,
	which: "style" | "excerpt",
): string {
	const file = which === "style" ? "style.md" : "excerpts.md";
	return join(bookDir(libraryRoot, bookId), "analysis", file);
}

/**
 * 生成分段 id（`<bookId>-p<6位序>`；全库唯一、可排序、可作文件名）
 * @param bookId 书 id
 * @param seq 全书分段序（1 起）
 * @returns 分段 id
 */
export function paragraphIdOf(bookId: string, seq: number): string {
	return `${bookId}-p${String(seq).padStart(6, "0")}`;
}
