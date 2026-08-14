/**
 * SqliteNovelStore：sqlite 版 NovelStore（node:sqlite，无原生依赖）。
 * 与 InMemoryNovelStore 同语义：乐观锁 update/delete 校验 baseRevision === entityVersion。
 */

import { DatabaseSync } from "node:sqlite";
import type { NovelQuery } from "./contract/query.js";
import type { NovelMutation } from "./contract/mutation.js";
import type { NovelMutateResult } from "./contract/snapshot.js";
import type { NovelStore } from "./store.js";
import type {
	Character,
	Location,
	Paragraph,
	PublicationChapter,
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

/** sqlite 版 novel 存储（query 读 / mutate 写 + revision 乐观锁） */
export class SqliteNovelStore implements NovelStore {
	private readonly db: DatabaseSync;
	private readonly outline: StoryOutline;

	/**
	 * @param dbPath sqlite 文件路径（:memory: 供测试）
	 */
	constructor(dbPath: string) {
		this.db = new DatabaseSync(dbPath);
		this.outline = { id: "outline_1", novelId: "novel_1" } as StoryOutline;
		this.migrate();
	}

	/** 建表 + 种子 outline */
	private migrate(): void {
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS outline (id TEXT PRIMARY KEY, novel_id TEXT NOT NULL);
			CREATE TABLE IF NOT EXISTS story_units (
				id TEXT PRIMARY KEY, entity_version INTEGER NOT NULL, outline_id TEXT NOT NULL,
				parent_id TEXT, order_key TEXT NOT NULL, title TEXT NOT NULL, intent TEXT, synopsis TEXT,
				scope TEXT, planning_status TEXT NOT NULL, realization_status TEXT NOT NULL,
				block_state TEXT, abandonment TEXT
			);
			CREATE TABLE IF NOT EXISTS characters (
				id TEXT PRIMARY KEY, entity_version INTEGER NOT NULL, name TEXT NOT NULL,
				aliases TEXT NOT NULL, summary TEXT, initial_state TEXT, author_notes TEXT,
				created_at TEXT NOT NULL, updated_at TEXT NOT NULL
			);
			CREATE TABLE IF NOT EXISTS locations (
				id TEXT PRIMARY KEY, entity_version INTEGER NOT NULL, name TEXT NOT NULL,
				aliases TEXT NOT NULL, summary TEXT, initial_state TEXT, author_notes TEXT,
				created_at TEXT NOT NULL, updated_at TEXT NOT NULL
			);
			CREATE TABLE IF NOT EXISTS paragraphs (
				id TEXT PRIMARY KEY, entity_version INTEGER NOT NULL, story_unit_id TEXT NOT NULL,
				order_key TEXT NOT NULL, text TEXT NOT NULL
			);
			CREATE TABLE IF NOT EXISTS volumes (
				id TEXT PRIMARY KEY, entity_version INTEGER NOT NULL, order_key TEXT NOT NULL, title TEXT NOT NULL
			);
			CREATE TABLE IF NOT EXISTS chapters (
				id TEXT PRIMARY KEY, entity_version INTEGER NOT NULL, volume_id TEXT,
				order_key TEXT NOT NULL, title TEXT NOT NULL, story_unit_id TEXT
			);
		`);
		this.db
			.prepare("INSERT OR IGNORE INTO outline (id, novel_id) VALUES (?, ?)")
			.run(this.outline.id, this.outline.novelId);
	}

	/** 查询（按 op 判别返回对应 snapshot） */
	async query(q: NovelQuery): Promise<unknown> {
		switch (q.op) {
			case "overview.get": {
				const count = (table: string): number =>
					(this.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
				return {
					novelId: this.outline.novelId,
					title: "未命名小说",
				counts: {
					storyUnits: count("story_units"),
					characters: count("characters"),
					locations: count("locations"),
					volumes: count("volumes"),
					chapters: count("chapters"),
					paragraphs: count("paragraphs"),
				},
				};
			}
			case "outline.get":
				return { outline: this.outline, units: this.listStoryUnits() };
			case "outline.storyUnit.get":
				return this.getStoryUnit(q.storyUnitId);
			case "characters.list":
				return this.listCharacters();
			case "characters.get":
				return this.getCharacter(q.characterId);
			case "locations.list":
				return this.listLocations();
			case "locations.get":
				return this.getLocation(q.locationId);
			case "paragraphs.list":
				return this.listParagraphs(q.storyUnitId);
			case "paragraph.get":
				return this.getParagraph(q.paragraphId);
			case "publication.get":
				return {
					structure: {},
					volumes: this.listVolumes(),
					chapters: this.listChapters(),
				};
		}
	}

	/** 变更（switch op + revision 乐观锁校验） */
	async mutate(m: NovelMutation): Promise<NovelMutateResult> {
		switch (m.op) {
			case "outline.storyUnit.create": {
				const su: StoryUnit = {
					id: nextId("su"),
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
				} as StoryUnit;
				this.insertStoryUnit(su);
				return this.result(su.entityVersion, su.id, "outline");
			}
			case "outline.storyUnit.update": {
				const su = this.getStoryUnit(m.storyUnitId);
				this.checkRevision(su.entityVersion, m.baseRevision, su.id);
				this.updateStoryUnit(m.storyUnitId, su.entityVersion + 1, m.patch);
				return this.result(su.entityVersion + 1, su.id, "outline");
			}
			case "outline.storyUnit.move": {
				const su = this.getStoryUnit(m.storyUnitId);
				this.checkRevision(su.entityVersion, m.baseRevision, su.id);
				this.db
					.prepare("UPDATE story_units SET parent_id = ?, order_key = ?, entity_version = ? WHERE id = ?")
					.run(m.parentId ?? su.parentId ?? null, m.orderKey, su.entityVersion + 1, su.id);
				return this.result(su.entityVersion + 1, su.id, "outline");
			}
			case "outline.storyUnit.delete": {
				const su = this.getStoryUnit(m.storyUnitId);
				this.checkRevision(su.entityVersion, m.baseRevision, su.id);
				this.db.prepare("DELETE FROM story_units WHERE id = ?").run(su.id);
				return this.result(su.entityVersion, su.id, "outline");
			}
			case "character.create":
				return this.createEntity("characters", m.input, "character");
			case "character.update": {
				const e = this.getCharacter(m.characterId);
				this.checkRevision(e.entityVersion, m.baseRevision, e.id);
				this.updateEntity("characters", e.id, e.entityVersion + 1, m.patch);
				return this.result(e.entityVersion + 1, e.id, "character");
			}
			case "character.delete": {
				const e = this.getCharacter(m.characterId);
				this.checkRevision(e.entityVersion, m.baseRevision, e.id);
				this.db.prepare("DELETE FROM characters WHERE id = ?").run(e.id);
				return this.result(e.entityVersion, e.id, "character");
			}
			case "location.create":
				return this.createEntity("locations", m.input, "location");
			case "location.update": {
				const e = this.getLocation(m.locationId);
				this.checkRevision(e.entityVersion, m.baseRevision, e.id);
				this.updateEntity("locations", e.id, e.entityVersion + 1, m.patch);
				return this.result(e.entityVersion + 1, e.id, "location");
			}
			case "location.delete": {
				const e = this.getLocation(m.locationId);
				this.checkRevision(e.entityVersion, m.baseRevision, e.id);
				this.db.prepare("DELETE FROM locations WHERE id = ?").run(e.id);
				return this.result(e.entityVersion, e.id, "location");
			}
			case "paragraph.insert": {
				const p: Paragraph = {
					id: nextId("para"),
					entityVersion: 1,
					storyUnitId: m.storyUnitId,
					orderKey: m.orderKey,
					text: m.text,
				} as Paragraph;
				this.db
					.prepare("INSERT INTO paragraphs (id, entity_version, story_unit_id, order_key, text) VALUES (?, ?, ?, ?, ?)")
					.run(p.id, p.entityVersion, p.storyUnitId, p.orderKey, p.text);
				return this.result(p.entityVersion, p.id, "paragraph");
			}
			case "paragraph.update": {
				const p = this.getParagraph(m.paragraphId);
				this.checkRevision(p.entityVersion, m.baseRevision, p.id);
				this.db
					.prepare("UPDATE paragraphs SET text = ?, entity_version = ? WHERE id = ?")
					.run(m.text, p.entityVersion + 1, p.id);
				return this.result(p.entityVersion + 1, p.id, "paragraph");
			}
			case "paragraph.delete": {
				const p = this.getParagraph(m.paragraphId);
				this.checkRevision(p.entityVersion, m.baseRevision, p.id);
				this.db.prepare("DELETE FROM paragraphs WHERE id = ?").run(p.id);
				return this.result(p.entityVersion, p.id, "paragraph");
			}
			case "publication.volume.create": {
				const v: PublicationVolume = {
					id: nextId("vol"),
					entityVersion: 1,
					orderKey: m.orderKey,
					title: m.title,
				} as PublicationVolume;
				this.db
					.prepare("INSERT INTO volumes (id, entity_version, order_key, title) VALUES (?, ?, ?, ?)")
					.run(v.id, v.entityVersion, v.orderKey, v.title);
				return this.result(v.entityVersion, v.id, "publication");
			}
			case "publication.volume.update": {
				const v = this.getVolume(m.volumeId);
				this.checkRevision(v.entityVersion, m.baseRevision, v.id);
				this.db
					.prepare("UPDATE volumes SET title = ?, order_key = ?, entity_version = ? WHERE id = ?")
					.run(m.patch.title ?? v.title, m.patch.orderKey ?? v.orderKey, v.entityVersion + 1, v.id);
				return this.result(v.entityVersion + 1, v.id, "publication");
			}
			case "publication.volume.delete": {
				const v = this.getVolume(m.volumeId);
				this.checkRevision(v.entityVersion, m.baseRevision, v.id);
				this.db.prepare("DELETE FROM volumes WHERE id = ?").run(v.id);
				return this.result(v.entityVersion, v.id, "publication");
			}
			case "publication.chapter.create": {
				const c: PublicationChapter = {
					id: nextId("ch"),
					entityVersion: 1,
					volumeId: m.volumeId,
					orderKey: m.orderKey,
					title: m.title,
					storyUnitId: m.storyUnitId,
				} as PublicationChapter;
				this.db
					.prepare("INSERT INTO chapters (id, entity_version, volume_id, order_key, title, story_unit_id) VALUES (?, ?, ?, ?, ?, ?)")
					.run(c.id, c.entityVersion, c.volumeId ?? null, c.orderKey, c.title, c.storyUnitId ?? null);
				return this.result(c.entityVersion, c.id, "publication");
			}
			case "publication.chapter.update": {
				const c = this.getChapter(m.chapterId);
				this.checkRevision(c.entityVersion, m.baseRevision, c.id);
				this.db
					.prepare("UPDATE chapters SET title = ?, volume_id = ?, order_key = ?, entity_version = ? WHERE id = ?")
					.run(m.patch.title ?? c.title, m.patch.volumeId ?? c.volumeId ?? null, m.patch.orderKey ?? c.orderKey, c.entityVersion + 1, c.id);
				return this.result(c.entityVersion + 1, c.id, "publication");
			}
			case "publication.chapter.delete": {
				const c = this.getChapter(m.chapterId);
				this.checkRevision(c.entityVersion, m.baseRevision, c.id);
				this.db.prepare("DELETE FROM chapters WHERE id = ?").run(c.id);
				return this.result(c.entityVersion, c.id, "publication");
			}
		}
	}

	// ── 读 ──
	private listStoryUnits(): StoryUnit[] {
		return (this.db.prepare("SELECT * FROM story_units").all() as unknown as Row[]).map(toStoryUnit);
	}
	private getStoryUnit(id: string): StoryUnit {
		const row = this.db.prepare("SELECT * FROM story_units WHERE id = ?").get(id) as unknown as Row | undefined;
		if (!row) throw new Error(`未找到 story unit: ${id}`);
		return toStoryUnit(row);
	}
	private listCharacters(): Character[] {
		return (this.db.prepare("SELECT * FROM characters").all() as unknown as Row[]).map(toEntity);
	}
	private getCharacter(id: string): Character {
		const row = this.db.prepare("SELECT * FROM characters WHERE id = ?").get(id) as unknown as Row | undefined;
		if (!row) throw new Error(`未找到 character: ${id}`);
		return toEntity(row) as Character;
	}
	private listLocations(): Location[] {
		return (this.db.prepare("SELECT * FROM locations").all() as unknown as Row[]).map(toEntity);
	}
	private getLocation(id: string): Location {
		const row = this.db.prepare("SELECT * FROM locations WHERE id = ?").get(id) as unknown as Row | undefined;
		if (!row) throw new Error(`未找到 location: ${id}`);
		return toEntity(row) as Location;
	}
	private listParagraphs(storyUnitId: string): Paragraph[] {
		return (
			this.db.prepare("SELECT * FROM paragraphs WHERE story_unit_id = ? ORDER BY order_key").all(storyUnitId) as unknown as Row[]
		).map(toParagraph);
	}
	private getParagraph(id: string): Paragraph {
		const row = this.db.prepare("SELECT * FROM paragraphs WHERE id = ?").get(id) as unknown as Row | undefined;
		if (!row) throw new Error(`未找到 paragraph: ${id}`);
		return toParagraph(row);
	}
	private listVolumes(): PublicationVolume[] {
		return (this.db.prepare("SELECT * FROM volumes").all() as unknown as Row[]).map(toVolume);
	}
	private getVolume(id: string): PublicationVolume {
		const row = this.db.prepare("SELECT * FROM volumes WHERE id = ?").get(id) as unknown as Row | undefined;
		if (!row) throw new Error(`未找到 volume: ${id}`);
		return toVolume(row);
	}
	private listChapters(): PublicationChapter[] {
		return (this.db.prepare("SELECT * FROM chapters").all() as unknown as Row[]).map(toChapter);
	}
	private getChapter(id: string): PublicationChapter {
		const row = this.db.prepare("SELECT * FROM chapters WHERE id = ?").get(id) as unknown as Row | undefined;
		if (!row) throw new Error(`未找到 chapter: ${id}`);
		return toChapter(row);
	}

	// ── 写 ──
	private insertStoryUnit(su: StoryUnit): void {
		this.db
			.prepare(
				"INSERT INTO story_units (id, entity_version, outline_id, parent_id, order_key, title, intent, synopsis, scope, planning_status, realization_status, block_state, abandonment) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
			)
			.run(
				su.id, su.entityVersion, su.outlineId, su.parentId ?? null, su.orderKey, su.title,
				su.intent ?? null, su.synopsis ?? null, su.scope ?? null, su.planningStatus, su.realizationStatus,
				su.blockState ? JSON.stringify(su.blockState) : null,
				su.abandonment ? JSON.stringify(su.abandonment) : null,
			);
	}
	private updateStoryUnit(id: string, version: number, patch: Record<string, unknown>): void {
		this.db
			.prepare(
				"UPDATE story_units SET title = ?, intent = ?, synopsis = ?, scope = ?, planning_status = ?, realization_status = ?, entity_version = ? WHERE id = ?",
			)
			.run(
				(patch.title as string | undefined) ?? this.getStoryUnit(id).title,
				(patch.intent as string | undefined) ?? this.getStoryUnit(id).intent ?? null,
				(patch.synopsis as string | undefined) ?? this.getStoryUnit(id).synopsis ?? null,
				(patch.scope as string | undefined) ?? this.getStoryUnit(id).scope ?? null,
				(patch.planningStatus as string | undefined) ?? this.getStoryUnit(id).planningStatus,
				(patch.realizationStatus as string | undefined) ?? this.getStoryUnit(id).realizationStatus,
				version, id,
			);
	}
	private createEntity(
		table: "characters" | "locations",
		input: { name: string; aliases?: readonly string[]; summary?: string; initialState?: string; authorNotes?: string },
		entity: NovelChangeEntity,
	): NovelMutateResult {
		const now = new Date().toISOString();
		const id = nextId(entity === "character" ? "char" : "loc");
		this.db
			.prepare(`INSERT INTO ${table} (id, entity_version, name, aliases, summary, initial_state, author_notes, created_at, updated_at) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?)`)
			.run(id, input.name, JSON.stringify(input.aliases ?? []), input.summary ?? null, input.initialState ?? null, input.authorNotes ?? null, now, now);
		return this.result(1, id, entity);
	}
	private updateEntity(
		table: "characters" | "locations",
		id: string,
		version: number,
		patch: Partial<{ name: string; aliases: readonly string[]; summary: string; initialState: string; authorNotes: string }>,
	): void {
		const current = table === "characters" ? this.getCharacter(id) : this.getLocation(id);
		this.db
			.prepare(`UPDATE ${table} SET name = ?, aliases = ?, summary = ?, initial_state = ?, author_notes = ?, entity_version = ?, updated_at = ? WHERE id = ?`)
			.run(
				patch.name ?? current.name,
				JSON.stringify(patch.aliases ?? current.aliases),
				patch.summary ?? current.summary ?? null,
				patch.initialState ?? current.initialState ?? null,
				patch.authorNotes ?? current.authorNotes ?? null,
				version, new Date().toISOString(), id,
			);
	}

	/** 乐观锁校验：baseRevision ≠ 当前 entityVersion 抛 stale */
	private checkRevision(current: number, base: number, id: string): void {
		if (current !== base) {
			throw new NovelStaleRevisionError(id, current, base);
		}
	}

	/** 构造 mutate 结果 */
	private result(version: number, changeId: string, entity: NovelChangeEntity): NovelMutateResult {
		return { version, changeId, entity };
	}
}

// ── 行映射 ──
type Row = Record<string, unknown>;

function toStoryUnit(row: Row): StoryUnit {
	return {
		id: row.id as string,
		entityVersion: row.entity_version as number,
		outlineId: row.outline_id as string,
		parentId: row.parent_id as string | undefined,
		orderKey: row.order_key as string,
		title: row.title as string,
		intent: row.intent as string | undefined,
		synopsis: row.synopsis as string | undefined,
		scope: row.scope as StoryUnit["scope"],
		planningStatus: row.planning_status as StoryUnit["planningStatus"],
		realizationStatus: row.realization_status as StoryUnit["realizationStatus"],
		blockState: row.block_state ? (JSON.parse(row.block_state as string) as StoryUnit["blockState"]) : undefined,
		abandonment: row.abandonment ? (JSON.parse(row.abandonment as string) as StoryUnit["abandonment"]) : undefined,
	} as StoryUnit;
}

function toEntity(row: Row): Character & Location {
	return {
		id: row.id as string,
		entityVersion: row.entity_version as number,
		name: row.name as string,
		aliases: JSON.parse(row.aliases as string) as readonly string[],
		summary: row.summary as string | undefined,
		initialState: row.initial_state as string | undefined,
		authorNotes: row.author_notes as string | undefined,
		createdAt: row.created_at as string,
		updatedAt: row.updated_at as string,
	} as Character & Location;
}

function toParagraph(row: Row): Paragraph {
	return {
		id: row.id as string,
		entityVersion: row.entity_version as number,
		storyUnitId: row.story_unit_id as string,
		orderKey: row.order_key as string,
		text: row.text as string,
	} as Paragraph;
}

function toVolume(row: Row): PublicationVolume {
	return {
		id: row.id as string,
		entityVersion: row.entity_version as number,
		orderKey: row.order_key as string,
		title: row.title as string,
	} as PublicationVolume;
}

function toChapter(row: Row): PublicationChapter {
	return {
		id: row.id as string,
		entityVersion: row.entity_version as number,
		volumeId: row.volume_id as string | undefined,
		orderKey: row.order_key as string,
		title: row.title as string,
		storyUnitId: row.story_unit_id as string | undefined,
	} as PublicationChapter;
}
