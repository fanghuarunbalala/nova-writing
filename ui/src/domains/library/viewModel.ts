/**
 * 书库域视图模型：状态/统计/格式的纯函数映射（demo app-redesign-demo v0.9 对齐）。
 */
import type { BookStatus } from "@novel/core";
import type { StatusChipVariant } from "../../shared/primitives/StatusChip.js";

/** 书状态 → chip 语义档 */
export function bookStatusChip(status: BookStatus): StatusChipVariant {
	if (status === "已完成") return "success";
	if (status === "解析失败") return "danger";
	return "warn";
}

/** 字数缩写（≥1 万 → x.x 万） */
export function formatChars(n: number): string {
	return n >= 10000 ? `${(n / 10000).toFixed(1)} 万` : String(n);
}

/** 书行副信息（章数 · 字数） */
export function bookSubtitle(stats: { chapters: number; chars: number }): string {
	return `${stats.chapters} 章 · ${formatChars(stats.chars)} 字`;
}

/** 是否可读解析产物（大纲/人物/地点/风格/摘录） */
export function analysisReady(book: { status: BookStatus }): boolean {
	return book.status === "已完成";
}
