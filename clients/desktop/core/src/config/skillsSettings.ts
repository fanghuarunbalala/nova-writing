/**
 * 技能设置校验（config 域 skillsDisabled 名单；store 双实现共用）。
 */
import { SKILL_NAME_MAX_LENGTH, SKILL_NAME_PATTERN } from "../runtime/skill/SkillRegistry.js";

/**
 * 校验并归一禁用名单：去重 + 每项须为合法技能名（`/^[a-z0-9-]+$/` 且 ≤64 字符）。
 * @param names 待校验名单
 * @returns 去重后的名单
 * @throws 任一项非法时抛错（中文消息，对齐 validateRuntimeSettings 风格）
 */
export function validateSkillsDisabled(names: readonly string[]): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const name of names) {
		if (
			typeof name !== "string" ||
			name.length === 0 ||
			name.length > SKILL_NAME_MAX_LENGTH ||
			!SKILL_NAME_PATTERN.test(name)
		) {
			throw new Error(`skillsDisabled 含非法技能名: ${String(name)}`);
		}
		if (!seen.has(name)) {
			seen.add(name);
			result.push(name);
		}
	}
	return result;
}
