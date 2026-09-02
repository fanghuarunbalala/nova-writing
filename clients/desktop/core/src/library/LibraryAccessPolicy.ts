/**
 * 工作区书单（访问控制，PRD library-完本解构 F10）：allowlist 存工作区侧
 * `.novel/library.json`，默认（缺失/空/损坏）不可见任何书，逐书 opt-in。
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isValidBookId } from "./LibraryPaths.js";

/** 工作区书单文件名（工作区根下 .novel/ 内） */
export const LIBRARY_ACCESS_FILE_NAME = "library.json";

/** 书单文件内容契约：{ books: bookId[] } */
interface LibraryAccessFile {
	readonly books?: readonly unknown[];
}

/**
 * 读工作区书单（allowlist）
 * @param workspaceRoot 工作区根
 * @param loggerWarn 损坏告警回调（缺省不告警）
 * @returns 授权 bookId 集合（文件缺失/损坏/空 → 空集合 = 不可见任何书）
 */
export async function readLibraryAllowlist(
	workspaceRoot: string,
	loggerWarn?: (message: string) => void,
): Promise<Set<string>> {
	const path = join(workspaceRoot, ".novel", LIBRARY_ACCESS_FILE_NAME);
	let raw: string;
	try {
		raw = await readFile(path, "utf8");
	} catch {
		return new Set<string>();
	}
	try {
		const parsed = JSON.parse(raw) as LibraryAccessFile;
		if (parsed === null || typeof parsed !== "object" || !Array.isArray(parsed.books)) {
			throw new Error("books 字段缺失或非数组");
		}
		const books = new Set<string>();
		for (const id of parsed.books) {
			if (typeof id === "string" && isValidBookId(id)) books.add(id);
		}
		return books;
	} catch (err) {
		loggerWarn?.(
			`书单文件损坏，按空书单处理（${path}）：${err instanceof Error ? err.message : String(err)}`,
		);
		return new Set<string>();
	}
}

/**
 * 把书加入工作区书单（F12 书单维护 / GUI 导入自动授权）：读现有集合 → 并集 → 写回。
 * 损坏的现有文件按空集合处理后重建（自愈）。
 * @param workspaceRoot 工作区根
 * @param bookId 书 id（非法 id 抛错）
 */
export async function addBookToLibraryAllowlist(
	workspaceRoot: string,
	bookId: string,
): Promise<void> {
	if (!isValidBookId(bookId)) {
		throw new Error(`非法 bookId：${bookId}`);
	}
	const existing = await readLibraryAllowlist(workspaceRoot);
	if (existing.has(bookId)) return;
	const books = [...existing, bookId].sort();
	const dir = join(workspaceRoot, ".novel");
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, LIBRARY_ACCESS_FILE_NAME), `${JSON.stringify({ books }, null, "\t")}\n`, "utf8");
}
