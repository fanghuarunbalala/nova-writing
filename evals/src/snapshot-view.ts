/**
 * 终态快照视图：空安全的类型化读取（兜底 metrics 的 storeSnapshot 为 null，
 * 断言谓词不得对其抛异常——cases.test.ts 结构自测锁死此纪律）。
 */
import type { NovelStoreSnapshot } from "./types.js";

/** unknown → 数组（非数组/null → 空数组） */
export function listOf<T>(value: unknown): Array<T> {
	return Array.isArray(value) ? (value as Array<T>) : [];
}

export interface OutlineUnitView {
	id: string;
	title?: string;
	parentId?: string;
}

export function outlineUnits(s: NovelStoreSnapshot): Array<OutlineUnitView> {
	const outline = s.outline as { units?: unknown } | null;
	return Array.isArray(outline?.units) ? (outline.units as Array<OutlineUnitView>) : [];
}

export interface PublicationView {
	volumes: Array<{ id: string; title?: string }>;
	chapters: Array<{ title?: string; volumeId?: string; paragraphIds?: string[] }>;
}

export function publicationOf(s: NovelStoreSnapshot): PublicationView {
	const p = s.publication as { volumes?: unknown; chapters?: unknown } | null;
	return {
		volumes: Array.isArray(p?.volumes) ? (p.volumes as PublicationView["volumes"]) : [],
		chapters: Array.isArray(p?.chapters) ? (p.chapters as PublicationView["chapters"]) : [],
	};
}
