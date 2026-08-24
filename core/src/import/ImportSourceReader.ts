/**
 * 导入源读取：txt 直读 / zip 提取全部 .txt 按全路径自然排序拼接为全书。
 * 编码探测复用书库 decodeBookSource（UTF-8 → GB18030 → Big5，逐文件探测——
 * zip 内各分片编码可能不一）。zip bomb 护栏：包体大小 + 解码后总字符 + 条目数上限。
 */
import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import { unzipSync } from "fflate";
import { decodeBookSource } from "../library/LibraryService.js";
import { ImportError } from "./ImportError.js";

/** 单源文件（txt 或 zip 包体）大小上限（对齐书库 20 MiB） */
const SOURCE_MAX_BYTES = 20 * 1024 * 1024;

/** 解码后全书总字符上限（zip 解压护栏） */
const DECODED_MAX_CHARS = 20 * 1024 * 1024;

/** zip 内条目数上限（护栏） */
const ZIP_MAX_ENTRIES = 2000;

/** 读取结果 */
export interface ImportSourceContent {
	/** 全书文本（多 txt 以空行连接；UTF-8） */
	readonly text: string;
	/** 源类型 */
	readonly kind: "txt" | "zip";
	/** 源文件名（展示与 source/ 落盘名） */
	readonly sourceName: string;
	/** zip 内被忽略的非 .txt 条目（相对路径，展示给用户） */
	readonly skippedFiles: readonly string[];
}

/**
 * 读取导入源文件为全书文本
 * @param sourcePath 源路径（宿主白名单授权）
 * @returns 全书文本 + 元信息
 */
export async function readImportSource(sourcePath: string): Promise<ImportSourceContent> {
	let buf: Buffer;
	try {
		const s = await stat(sourcePath);
		if (!s.isFile()) {
			throw new ImportError("IMP_INVALID_ARGUMENT", "源路径不是文件");
		}
		if (s.size > SOURCE_MAX_BYTES) {
			throw new ImportError(
				"IMP_INVALID_ARGUMENT",
				`源文件超过 20 MiB 上限（${s.size} 字节）`,
			);
		}
		buf = await readFile(sourcePath);
	} catch (err) {
		if (err instanceof ImportError) throw err;
		throw new ImportError(
			"IMP_IMPORT_FAILED",
			`源文件不可读：${err instanceof Error ? err.message : String(err)}`,
		);
	}
	const sourceName = basename(sourcePath);
	if (/\.zip$/i.test(sourceName)) {
		return readZipSource(buf, sourceName);
	}
	return {
		text: decodeBookSource(buf),
		kind: "txt",
		sourceName,
		skippedFiles: [],
	};
}

/**
 * 解析 zip 源：全部 .txt 条目按全路径自然排序（数字段数值比较，10.txt 排在 9.txt 后）
 * 逐条解码后以空行拼接；目录条目与 __MACOSX 元数据忽略，其余非 .txt 记入 skippedFiles
 * @param buf zip 包体
 * @param sourceName zip 文件名
 * @returns 全书文本 + 元信息
 */
function readZipSource(buf: Buffer, sourceName: string): ImportSourceContent {
	let entries: Record<string, Uint8Array>;
	try {
		entries = unzipSync(new Uint8Array(buf));
	} catch (err) {
		throw new ImportError(
			"IMP_IMPORT_FAILED",
			`zip 解压失败：${err instanceof Error ? err.message : String(err)}`,
		);
	}
	const names = Object.keys(entries);
	if (names.length > ZIP_MAX_ENTRIES) {
		throw new ImportError("IMP_INVALID_ARGUMENT", `zip 条目过多（${names.length} > ${ZIP_MAX_ENTRIES}）`);
	}
	const txtNames: string[] = [];
	const skippedFiles: string[] = [];
	for (const name of names) {
		if (name.endsWith("/") || name.length === 0) continue;
		if (/__MACOSX\//i.test(name) || basename(name).startsWith("._")) continue;
		if (/\.txt$/i.test(name)) txtNames.push(name);
		else skippedFiles.push(name);
	}
	if (txtNames.length === 0) {
		throw new ImportError("IMP_INVALID_ARGUMENT", "zip 内没有任何 .txt 文件");
	}
	txtNames.sort(naturalCompare);
	const parts: string[] = [];
	let totalChars = 0;
	for (const name of txtNames) {
		const text = decodeBookSource(Buffer.from(entries[name]!));
		totalChars += text.length;
		if (totalChars > DECODED_MAX_CHARS) {
			throw new ImportError(
				"IMP_INVALID_ARGUMENT",
				`解压后总字符超过上限（> ${DECODED_MAX_CHARS}，防 zip 炸弹）`,
			);
		}
		parts.push(text);
	}
	return {
		text: parts.join("\n\n"),
		kind: "zip",
		sourceName,
		skippedFiles,
	};
}

/**
 * 自然排序比较（数字段按数值比较：chapter2 < chapter10）
 * @param a 路径 A
 * @param b 路径 B
 * @returns 排序值
 */
function naturalCompare(a: string, b: string): number {
	const pa = a.split(/(\d+)/);
	const pb = b.split(/(\d+)/);
	const len = Math.min(pa.length, pb.length);
	for (let i = 0; i < len; i += 1) {
		if (pa[i] === pb[i]) continue;
		const na = Number(pa[i]);
		const nb = Number(pb[i]);
		if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
		return (pa[i] ?? "") < (pb[i] ?? "") ? -1 : 1;
	}
	return pa.length - pb.length;
}
