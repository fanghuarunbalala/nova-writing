import { describe, expect, it } from "vitest";
import { formatRelativeTime } from "../../src/shared/format/relativeTime.js";

/** 以固定「今天 14:00」为基准构造时间戳 */
const NOW = new Date(2026, 7, 15, 14, 0, 0).getTime();

describe("formatRelativeTime", () => {
	it("未知时间（0/负值/未来）返回空串", () => {
		expect(formatRelativeTime(0, NOW)).toBe("");
		expect(formatRelativeTime(-1, NOW)).toBe("");
		expect(formatRelativeTime(NOW + 1000, NOW)).toBe("");
	});

	it("一分钟内 → 刚刚", () => {
		expect(formatRelativeTime(NOW - 30_000, NOW)).toBe("刚刚");
	});

	it("一小时内 → N 分钟前", () => {
		expect(formatRelativeTime(NOW - 5 * 60_000, NOW)).toBe("5 分钟前");
		expect(formatRelativeTime(NOW - 59 * 60_000, NOW)).toBe("59 分钟前");
	});

	it("今天更早 → N 小时前（不跨零点）", () => {
		// 今天 00:30（距基准 13.5h，但按天分组属于今天）
		expect(formatRelativeTime(new Date(2026, 7, 15, 0, 30).getTime(), NOW)).toBe("13 小时前");
	});

	it("昨天 → 昨天（跨零点 1 天内）", () => {
		expect(formatRelativeTime(new Date(2026, 7, 14, 22, 0).getTime(), NOW)).toBe("昨天");
		expect(formatRelativeTime(new Date(2026, 7, 14, 0, 5).getTime(), NOW)).toBe("昨天");
	});

	it("7 天内 → N 天前（按零点对齐计数）", () => {
		expect(formatRelativeTime(new Date(2026, 7, 13, 10, 0).getTime(), NOW)).toBe("2 天前");
		expect(formatRelativeTime(new Date(2026, 7, 8, 10, 0).getTime(), NOW)).toBe("7 天前");
	});

	it("超过 7 天 → 日期 YYYY-MM-DD", () => {
		expect(formatRelativeTime(new Date(2026, 7, 1, 10, 0).getTime(), NOW)).toBe("2026-08-01");
		expect(formatRelativeTime(new Date(2025, 11, 31, 23, 0).getTime(), NOW)).toBe("2025-12-31");
	});
});
