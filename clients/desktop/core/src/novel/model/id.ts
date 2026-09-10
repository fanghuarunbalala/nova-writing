/**
 * novel 域 branded 身份类型（与旧系统一致，opaque string）。
 * 品牌唯一符号保证类型不透明：不能与普通 string 混用。
 */

declare const novelIdBrand: unique symbol
export type NovelId = string & { readonly [novelIdBrand]: "NovelId" }

declare const storyOutlineIdBrand: unique symbol
export type StoryOutlineId = string & { readonly [storyOutlineIdBrand]: "StoryOutlineId" }

declare const storyUnitIdBrand: unique symbol
export type StoryUnitId = string & { readonly [storyUnitIdBrand]: "StoryUnitId" }

declare const characterIdBrand: unique symbol
export type CharacterId = string & { readonly [characterIdBrand]: "CharacterId" }

declare const locationIdBrand: unique symbol
export type LocationId = string & { readonly [locationIdBrand]: "LocationId" }

declare const paragraphIdBrand: unique symbol
export type ParagraphId = string & { readonly [paragraphIdBrand]: "ParagraphId" }

declare const publicationStructureIdBrand: unique symbol
export type PublicationStructureId = string & {
	readonly [publicationStructureIdBrand]: "PublicationStructureId"
}

declare const publicationVolumeIdBrand: unique symbol
export type PublicationVolumeId = string & {
	readonly [publicationVolumeIdBrand]: "PublicationVolumeId"
}

declare const publicationChapterIdBrand: unique symbol
export type PublicationChapterId = string & {
	readonly [publicationChapterIdBrand]: "PublicationChapterId"
}
