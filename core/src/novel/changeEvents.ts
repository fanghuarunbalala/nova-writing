/**
 * 变更事件派生：mutation 落库后应广播的 novel.changed 实体集合。
 * 默认只广播结果实体；级联删除会波及其他实体数据时追加，否则对应视图收不到刷新
 * （如 storyUnit.delete cascade 删段落并解绑章选择——正文视图依赖 paragraph 事件重拉）。
 */

import type { NovelChangeEntity } from "./contract/event.js";
import type { NovelMutation } from "./contract/mutation.js";
import type { NovelMutateResult } from "./contract/snapshot.js";

/** 派生该变更应广播的实体列表（去重；首项为结果实体，保持广播顺序稳定） */
export function deriveChangeEntities(m: NovelMutation, result: NovelMutateResult): NovelChangeEntity[] {
	const entities: NovelChangeEntity[] = [result.entity];
	// storyUnit 级联删除子树时删段落（章选择随之解绑）→ 正文数据变化须以 paragraph 事件触达
	if (m.op === "outline.storyUnit.delete" && (result.deleted ?? []).some((d) => d.kind === "paragraph")) {
		entities.push("paragraph");
	}
	return [...new Set(entities)];
}
