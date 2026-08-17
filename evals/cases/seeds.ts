/**
 * case 种子构建器：core NovelMutation 的薄封装，供各 case 声明预置状态。
 * 品牌化 id（StoryUnitId/PublicationVolumeId 等）以裸 string 构造——core 未导出
 * 构造器，形状合法性由 src/cases.test.ts 落库自测锁死（全新 InMemoryNovelStore mutateBatch）。
 */
import type { NovelMutation } from "@novel/core";

/** 品牌化 id 的裸 string 构造 */
function branded<T>(value: string): T {
	return value as unknown as T;
}

export function character(
	id: string,
	name: string,
	extra?: { summary?: string },
): NovelMutation {
	return {
		op: "character.create",
		id,
		input: {
			name,
			...(extra?.summary !== undefined ? { summary: extra.summary } : {}),
		},
	};
}

export function location(id: string, name: string): NovelMutation {
	return { op: "location.create", id, input: { name } };
}

export function storyUnit(
	id: string,
	title: string,
	opts?: { parentId?: string; scope?: "saga" | "arc" | "sequence" | "scene" | "custom" },
): NovelMutation {
	return {
		op: "outline.storyUnit.create",
		id,
		title,
		...(opts?.parentId !== undefined ? { parentId: branded(opts.parentId) } : {}),
		...(opts?.scope !== undefined ? { scope: opts.scope } : {}),
	};
}

export function paragraph(id: string, storyUnitId: string, text: string): NovelMutation {
	return { op: "paragraph.insert", id, storyUnitId: branded(storyUnitId), text };
}

export function volume(id: string, title: string): NovelMutation {
	return { op: "publication.volume.create", id, title };
}

export function chapter(
	id: string,
	title: string,
	opts?: { volumeId?: string },
): NovelMutation {
	return {
		op: "publication.chapter.create",
		id,
		title,
		...(opts?.volumeId !== undefined ? { volumeId: branded(opts.volumeId) } : {}),
	};
}
