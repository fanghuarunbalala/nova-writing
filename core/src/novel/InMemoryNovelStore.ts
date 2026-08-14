/**
 * InMemoryNovelStore：内存版 NovelStore（跑通 RPC 垂直切片）。
 * 乐观锁：update/delete 校验 baseRevision === 实体 entityVersion，stale 拒绝；成功后 entityVersion++。
 */
import type { NovelQuery } from "./contract/query.js";
import type { NovelMutation } from "./contract/mutation.js";
import type { NovelMutateResult } from "./contract/snapshot.js";
import type { NovelStore } from "./store.js";
import type {
	Character,
	Location,
	Paragraph,
	PublicationChapter,
	PublicationStructure,
	PublicationVolume,
	StoryOutline,
	StoryUnit,
} from "./model/index.js";
import type { NovelChangeEntity } from "./contract/event.js";
import { NovelStaleRevisionError } from "./errors.js";

/** id 递增计数器（进程内唯一） */
let idCounter = 0;

/** 生成实体 id */
function nextId(prefix: string): string {
	return `${prefix}_${(++idCounter).toString(36)}${Date.now().toString(36).slice(-4)}`;
}

/** 内存版 novel 存储（query 读 / mutate 写 + revision 乐观锁） */
export class InMemoryNovelStore implements NovelStore {
	private readonly characters = new Map<string, Character>();
	private readonly locations = new Map<string, Location>();
	private readonly storyUnits = new Map<string, StoryUnit>();
	private readonly paragraphs = new Map<string, Paragraph>();
	private readonly volumes = new Map<string, PublicationVolume>();
	private readonly chapters = new Map<string, PublicationChapter>();
	private readonly outline: StoryOutline = { id: "outline_1" as never, novelId: "novel_1" as never };

	/** 查询（按 op 判别返回对应 snapshot） */
	async query(q: NovelQuery): Promise<unknown> {
		switch (q.op) {
			case "overview.get":
				return {
					novelId: this.outline.novelId,
					title: "未命名小说",
					counts: {
						storyUnits: this.storyUnits.size,
						characters: this.characters.size,
						locations: this.locations.size,
						volumes: this.volumes.size,
						chapters: this.chapters.size,
						paragraphs: this.paragraphs.size,
					},
				};
			case "outline.get":
				return { outline: this.outline, units: [...this.storyUnits.values()] };
			case "outline.storyUnit.get":
				return this.require(this.storyUnits, q.storyUnitId, "story unit");
			case "characters.list":
				return [...this.characters.values()];
			case "characters.get":
				return this.require(this.characters, q.characterId, "character");
			case "locations.list":
				return [...this.locations.values()];
			case "locations.get":
				return this.require(this.locations, q.locationId, "location");
			case "paragraphs.list":
				return [...this.paragraphs.values()]
					.filter((p) => p.storyUnitId === q.storyUnitId)
					.sort((a, b) => a.orderKey.localeCompare(b.orderKey));
			case "paragraph.get":
				return this.require(this.paragraphs, q.paragraphId, "paragraph");
			case "publication.get":
				return {
					structure: {} as PublicationStructure,
					volumes: [...this.volumes.values()],
					chapters: [...this.chapters.values()],
				};
		}
	}

	/** 变更（switch op + revision 乐观锁校验） */
	async mutate(m: NovelMutation): Promise<NovelMutateResult> {
		switch (m.op) {
			// ── 大纲 ──
			case "outline.storyUnit.create": {
				const su: StoryUnit = {
					id: nextId("su") as never,
					entityVersion: 1,
					outlineId: this.outline.id,
					parentId: m.parentId,
					orderKey: m.orderKey,
					title: m.title,
					intent: m.intent,
					synopsis: m.synopsis,
					scope: m.scope,
					planningStatus: "idea",
					realizationStatus: "pending",
				};
				this.storyUnits.set(su.id, su);
				return this.result(su.entityVersion, su.id, "outline");
			}
			case "outline.storyUnit.update": {
				const su = this.require(this.storyUnits, m.storyUnitId, "story unit");
				this.checkRevision(su.entityVersion, m.baseRevision, su.id);
				Object.assign(su, m.patch);
				su.entityVersion++;
				return this.result(su.entityVersion, su.id, "outline");
			}
			case "outline.storyUnit.move": {
				const su = this.require(this.storyUnits, m.storyUnitId, "story unit");
				this.checkRevision(su.entityVersion, m.baseRevision, su.id);
				if (m.parentId !== undefined) su.parentId = m.parentId;
				su.orderKey = m.orderKey;
				su.entityVersion++;
				return this.result(su.entityVersion, su.id, "outline");
			}
			case "outline.storyUnit.delete": {
				const su = this.require(this.storyUnits, m.storyUnitId, "story unit");
				this.checkRevision(su.entityVersion, m.baseRevision, su.id);
				this.storyUnits.delete(su.id);
				return this.result(su.entityVersion, su.id, "outline");
			}
			// ── 角色 ──
			case "character.create":
				return this.createEntity(this.characters, m.input, "character");
			case "character.update": {
				const e = this.require(this.characters, m.characterId, "character");
				this.checkRevision(e.entityVersion, m.baseRevision, e.id);
				Object.assign(e, m.patch);
				e.entityVersion++;
				e.updatedAt = new Date().toISOString();
				return this.result(e.entityVersion, e.id, "character");
			}
			case "character.delete": {
				const e = this.require(this.characters, m.characterId, "character");
				this.checkRevision(e.entityVersion, m.baseRevision, e.id);
				this.characters.delete(e.id);
				return this.result(e.entityVersion, e.id, "character");
			}
			// ── 地点 ──
			case "location.create":
				return this.createEntity(this.locations, m.input, "location");
			case "location.update": {
				const e = this.require(this.locations, m.locationId, "location");
				this.checkRevision(e.entityVersion, m.baseRevision, e.id);
				Object.assign(e, m.patch);
				e.entityVersion++;
				e.updatedAt = new Date().toISOString();
				return this.result(e.entityVersion, e.id, "location");
			}
			case "location.delete": {
				const e = this.require(this.locations, m.locationId, "location");
				this.checkRevision(e.entityVersion, m.baseRevision, e.id);
				this.locations.delete(e.id);
				return this.result(e.entityVersion, e.id, "location");
			}
			// ── 段落 ──
			case "paragraph.insert": {
				const p: Paragraph = {
					id: nextId("para") as never,
					entityVersion: 1,
					storyUnitId: m.storyUnitId,
					orderKey: m.orderKey,
					text: m.text,
				};
				this.paragraphs.set(p.id, p);
				return this.result(p.entityVersion, p.id, "paragraph");
			}
			case "paragraph.update": {
				const p = this.require(this.paragraphs, m.paragraphId, "paragraph");
				this.checkRevision(p.entityVersion, m.baseRevision, p.id);
				p.text = m.text;
				p.entityVersion++;
				return this.result(p.entityVersion, p.id, "paragraph");
			}
			case "paragraph.delete": {
				const p = this.require(this.paragraphs, m.paragraphId, "paragraph");
				this.checkRevision(p.entityVersion, m.baseRevision, p.id);
				this.paragraphs.delete(p.id);
				return this.result(p.entityVersion, p.id, "paragraph");
			}
			// ── 发布 ──
			case "publication.volume.create": {
				const v: PublicationVolume = { id: nextId("vol") as never, entityVersion: 1, orderKey: m.orderKey, title: m.title };
				this.volumes.set(v.id, v);
				return this.result(v.entityVersion, v.id, "publication");
			}
			case "publication.volume.update": {
				const v = this.require(this.volumes, m.volumeId, "volume");
				this.checkRevision(v.entityVersion, m.baseRevision, v.id);
				Object.assign(v, m.patch);
				v.entityVersion++;
				return this.result(v.entityVersion, v.id, "publication");
			}
			case "publication.volume.delete": {
				const v = this.require(this.volumes, m.volumeId, "volume");
				this.checkRevision(v.entityVersion, m.baseRevision, v.id);
				this.volumes.delete(v.id);
				return this.result(v.entityVersion, v.id, "publication");
			}
			case "publication.chapter.create": {
				const c: PublicationChapter = {
					id: nextId("ch") as never,
					entityVersion: 1,
					volumeId: m.volumeId,
					orderKey: m.orderKey,
					title: m.title,
					storyUnitId: m.storyUnitId,
				};
				this.chapters.set(c.id, c);
				return this.result(c.entityVersion, c.id, "publication");
			}
			case "publication.chapter.update": {
				const c = this.require(this.chapters, m.chapterId, "chapter");
				this.checkRevision(c.entityVersion, m.baseRevision, c.id);
				Object.assign(c, m.patch);
				c.entityVersion++;
				return this.result(c.entityVersion, c.id, "publication");
			}
			case "publication.chapter.delete": {
				const c = this.require(this.chapters, m.chapterId, "chapter");
				this.checkRevision(c.entityVersion, m.baseRevision, c.id);
				this.chapters.delete(c.id);
				return this.result(c.entityVersion, c.id, "publication");
			}
		}
	}

	/** 乐观锁校验：baseRevision ≠ 当前 entityVersion 抛 stale */
	private checkRevision(current: number, base: number, id: string): void {
		if (current !== base) {
			throw new NovelStaleRevisionError(id, current, base);
		}
	}

	/** 从 Map 取实体，缺省抛错 */
	private require<T>(map: Map<string, T>, id: string, label: string): T {
		const e = map.get(id);
		if (!e) throw new Error(`未找到 ${label}: ${id}`);
		return e;
	}

	/** 创建实体（Character/Location 同构） */
	private createEntity(
		map: Map<string, Character> | Map<string, Location>,
		input: { name: string; aliases?: readonly string[]; summary?: string; initialState?: string; authorNotes?: string },
		entity: NovelChangeEntity,
	): NovelMutateResult {
		const now = new Date().toISOString();
		const e = {
			id: nextId(entity === "character" ? "char" : "loc") as never,
			entityVersion: 1,
			name: input.name,
			aliases: input.aliases ?? [],
			summary: input.summary,
			initialState: input.initialState,
			authorNotes: input.authorNotes,
			createdAt: now,
			updatedAt: now,
		} as Character & Location;
		(map as Map<string, Character & Location>).set(e.id, e);
		return this.result(1, e.id, entity);
	}

	/** 构造 mutate 结果 */
	private result(version: number, changeId: string, entity: NovelChangeEntity): NovelMutateResult {
		return { version, changeId, entity };
	}
}
