/**
 * matcher：toolArgs / toolResponse / file 的匹配器（PRD §3.5）。
 * 谓词为主形态，内置 helper：jsonSubset（深度子集）/ contains / regex。
 * 统一签名 (value, raw)：value 为解析后的 JSON（可解析时），raw 为原始文本。
 */

/** 统一匹配器签名 */
export type ValueMatcher = (value: unknown, raw: string) => boolean;

/**
 * 深度子集匹配：对象按键子集（期望的每个键须存在且值匹配）、数组按位前缀子集
 * （期望长度 ≤ 实际、逐位匹配）、标量严格相等；期望值出现 RegExp 时对实际字符串 test。
 */
export function jsonSubset(shape: unknown): ValueMatcher {
	return (value) => subsetMatch(shape, value);
}

function subsetMatch(expected: unknown, actual: unknown): boolean {
	if (expected instanceof RegExp) {
		return typeof actual === "string" && expected.test(actual);
	}
	if (Array.isArray(expected)) {
		if (!Array.isArray(actual) || actual.length < expected.length) return false;
		return expected.every((e, i) => subsetMatch(e, actual[i]));
	}
	if (expected !== null && typeof expected === "object") {
		if (actual === null || typeof actual !== "object" || Array.isArray(actual)) {
			return false;
		}
		return Object.entries(expected as Record<string, unknown>).every(
			([key, val]) =>
				key in (actual as Record<string, unknown>) &&
				subsetMatch(val, (actual as Record<string, unknown>)[key]),
		);
	}
	return expected === actual;
}

/** 原始文本包含子串（value 通道忽略） */
export function contains(s: string): ValueMatcher {
	return (_value, raw) => raw.includes(s);
}

/** 原始文本正则匹配 */
export function regex(re: RegExp): ValueMatcher {
	return (_value, raw) => re.test(raw);
}

/** 字符串简写：等价 contains */
export function toMatcher(m: string | ValueMatcher): ValueMatcher {
	return typeof m === "string" ? contains(m) : m;
}

/** result 文本可解析为 JSON 时返回解析值，否则原文（toolResponse 的 value 通道） */
export function parseIfJson(text: string): unknown {
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return text;
	}
}
