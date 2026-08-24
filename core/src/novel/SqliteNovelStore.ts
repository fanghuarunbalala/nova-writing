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
import type { StoryUnitWithLeaf } from "./contract/snapshot.js";
import type { LeafPlan, LeafPlanPatch } from "./model/outline.js";
import { NovelDuplicateIdError, NovelStaleRevisionError } from "./errors.js";
import { ID_PATTERN, nextOrderKey } from "./keys.js";

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
	 * @param options 打开选项（readOnly：只读直开——跳过建表迁移，供书库读路径
	 *   跨进程并发访问；WAL 由建库方初始化，读写均受益）
	 */
	constructor(dbPath: string, options?: { readOnly?: boolean }) {
		this.db =
			options?.readOnly === true
				? new DatabaseSync(dbPath, { readOnly: true })
				: new DatabaseSync(dbPath);
		// 并发写等待：多 GUI 实例共享书库 book.db（WAL，单写者）时，
		// 写锁竞争等待重试（≤3s）而非直接抛 SQLITE_BUSY
		this.db.exec("PRAGMA busy_timeout=3000;");
		this.outline = { id: "outline_1", novelId: "novel_1" } as StoryOutline;
		if (options?.readOnly !== true) this.migrate();
	}

	/**
	 * 确保数据库为 WAL 模式（跨进程「单写者 + 多只读者」直开的前提；建库方调用一次）
	 * @param dbPath sqlite 文件路径
	 */
	static ensureWal(dbPath: string): void {
		const db = new DatabaseSync(dbPath);
		try {
			db.exec("PRAGMA journal_mode=WAL;");
		} finally {
			db.close();
		}
	}

	/** 关闭连接（workspace 切换热重绑 / 应用退出；关闭后本实例不可再用） */
	close(): void {
		this.db.close();
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
				order_key TEXT NOT NULL, text TEXT NOT NULL,
				rhythm TEXT NOT NULL DEFAULT 'hold', intensity INTEGER NOT NULL DEFAULT 3
			);
			CREATE TABLE IF NOT EXISTS volumes (
				id TEXT PRIMARY KEY, entity_version INTEGER NOT NULL, order_key TEXT NOT NULL, title TEXT NOT NULL
			);
			CREATE TABLE IF NOT EXISTS chapters (
				id TEXT PRIMARY KEY, entity_version INTEGER NOT NULL, volume_id TEXT,
				order_key TEXT NOT NULL, title TEXT NOT NULL, story_unit_id TEXT
			);
			CREATE TABLE IF NOT EXISTS leaf_story_unit_plans (
				story_unit_id TEXT PRIMARY KEY, plan_json TEXT NOT NULL
			);
			CREATE TABLE IF NOT EXISTS chapter_paragraphs (
				chapter_id TEXT NOT NULL, paragraph_id TEXT NOT NULL, position INTEGER NOT NULL,
				PRIMARY KEY (chapter_id, paragraph_id)
			);
		`);
		this.migrateParagraphBeatColumns();
		this.migrateChapterSelections();
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
			case "outline.get": {
				const units = this.listStoryUnits();
				if (q.includePlans === true) {
					return { outline: this.outline, units: this.attachLeafAndProgress(units) };
				}
				return { outline: this.outline, units };
			}
			case "outline.storyUnit.get": {
				const unit = this.getStoryUnit(q.storyUnitId);
				if (q.includePlans === true) {
					return this.attachLeafAndProgress([unit])[0];
				}
				return unit;
			}
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
		return this.applyMutation(m);
	}

	/** 变更执行体（纯同步，无 await——并发调用天然不交错，见 mutateBatch） */
	private applyMutation(m: NovelMutation): NovelMutateResult {
		switch (m.op) {
			case "outline.storyUnit.create": {
				const su: StoryUnit = {
					id: this.resolveId("story_units", m.id, "su", "story unit") as never,
					entityVersion: 1,
					outlineId: this.outline.id,
					parentId: m.parentId,
					orderKey: m.orderKey ?? nextOrderKey(this.maxOrderKey("story_units WHERE parent_id IS ?", m.parentId ?? null)),
					title: m.title,
					intent: m.intent,
					synopsis: m.synopsis,
					scope: m.scope,
					planningStatus: m.planningStatus ?? "idea",
					realizationStatus: m.realizationStatus ?? "pending",
					blockState: m.blockState,
					abandonment: m.abandonment,
				} as StoryUnit;
				this.insertStoryUnit(su);
				if (m.leaf !== undefined) this.saveLeafPlan(su.id, m.leaf);
				return this.result(su.entityVersion, su.id, "outline");
			}
			case "outline.storyUnit.update": {
				const su = this.getStoryUnit(m.storyUnitId);
				this.checkRevision(su.entityVersion, m.baseRevision, su.id);
				const { leaf, blockState, abandonment, ...rest } = m.patch;
				this.updateStoryUnit(m.storyUnitId, su.entityVersion + 1, { ...rest, blockState, abandonment });
				if (leaf !== undefined) this.applyLeafPatch(m.storyUnitId, leaf);
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
				const all = this.listStoryUnits();
				const childrenOf = (id: string): StoryUnit[] => all.filter((u) => u.parentId === id);
				const collect = (unit: StoryUnit, acc: StoryUnit[]): StoryUnit[] => {
					acc.push(unit);
					for (const child of childrenOf(unit.id)) collect(child, acc);
					return acc;
				};
				const subtree = collect(su, []);
				const leafPlans = this.db
					.prepare("SELECT story_unit_id, plan_json FROM leaf_story_unit_plans")
					.all() as unknown as Array<{ story_unit_id: string; plan_json: string }>;
				const paragraphs = (this.db.prepare("SELECT * FROM paragraphs").all() as unknown as Row[]).map(toParagraph);
				if (m.cascade !== true) {
					const childCount = subtree.length - 1;
					const hasLeaf = leafPlans.some((l) => l.story_unit_id === su.id);
					const paraCount = paragraphs.filter((p) => p.storyUnitId === su.id).length;
					if (childCount > 0 || hasLeaf || paraCount > 0) {
						const deps = [
							childCount > 0 ? `${childCount} 个子单元` : "",
							hasLeaf ? "leaf 计划" : "",
							paraCount > 0 ? `${paraCount} 个段落` : "",
						].filter(Boolean).join(" / ");
						throw new Error(`story unit ${su.id} 有依赖（${deps}）——需 cascade:true 级联删除整个子树`);
					}
				}
				const deleted: Array<{ kind: string; id: string; data: unknown }> = [];
				const delUnit = this.db.prepare("DELETE FROM story_units WHERE id = ?");
				const delLeaf = this.db.prepare("DELETE FROM leaf_story_unit_plans WHERE story_unit_id = ?");
				const delPara = this.db.prepare("DELETE FROM paragraphs WHERE id = ?");
				for (const unit of subtree) {
					const planRow = leafPlans.find((l) => l.story_unit_id === unit.id);
					if (planRow !== undefined) {
						deleted.push({ kind: "leaf_plan", id: unit.id, data: JSON.parse(planRow.plan_json) });
						delLeaf.run(unit.id);
					}
					for (const p of paragraphs.filter((pp) => pp.storyUnitId === unit.id)) {
						this.removeParagraphSelections(p.id);
						delPara.run(p.id);
						deleted.push({ kind: "paragraph", id: p.id, data: p });
					}
					delUnit.run(unit.id);
					deleted.push({ kind: "story_unit", id: unit.id, data: unit });
				}
				return this.result(su.entityVersion, su.id, "outline", deleted);
			}
			case "character.create":
				return this.createEntity("characters", m.id, m.input, "character");
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
				return this.createEntity("locations", m.id, m.input, "location");
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
					id: this.resolveId("paragraphs", m.id, "para", "paragraph") as never,
					entityVersion: 1,
					storyUnitId: m.storyUnitId,
					orderKey: m.orderKey ?? nextOrderKey(this.maxOrderKey("paragraphs WHERE story_unit_id = ?", m.storyUnitId)),
					text: m.text,
					rhythm: m.rhythm,
					intensity: m.intensity,
				} as Paragraph;
				this.db
					.prepare(
						"INSERT INTO paragraphs (id, entity_version, story_unit_id, order_key, text, rhythm, intensity) VALUES (?, ?, ?, ?, ?, ?, ?)",
					)
					.run(p.id, p.entityVersion, p.storyUnitId, p.orderKey, p.text, p.rhythm, p.intensity);
				return this.result(p.entityVersion, p.id, "paragraph");
			}
			case "paragraph.update": {
				const p = this.getParagraph(m.paragraphId);
				this.checkRevision(p.entityVersion, m.baseRevision, p.id);
				this.db
					.prepare(
						"UPDATE paragraphs SET text = ?, story_unit_id = ?, order_key = ?, rhythm = ?, intensity = ?, entity_version = ? WHERE id = ?",
					)
					.run(
						m.text ?? p.text,
						m.storyUnitId ?? p.storyUnitId,
						m.orderKey ?? p.orderKey,
						m.rhythm ?? p.rhythm,
						m.intensity ?? p.intensity,
						p.entityVersion + 1,
						p.id,
					);
				return this.result(p.entityVersion + 1, p.id, "paragraph");
			}
			case "paragraph.delete": {
				const p = this.getParagraph(m.paragraphId);
				this.checkRevision(p.entityVersion, m.baseRevision, p.id);
				this.removeParagraphSelections(p.id);
				this.db.prepare("DELETE FROM paragraphs WHERE id = ?").run(p.id);
				return this.result(p.entityVersion, p.id, "paragraph");
			}
			case "publication.volume.create": {
				const v: PublicationVolume = {
					id: this.resolveId("volumes", m.id, "vol", "volume") as never,
					entityVersion: 1,
					orderKey: m.orderKey ?? nextOrderKey(this.maxOrderKey("volumes")),
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
				const chapters = this.listChapters().filter((c) => c.volumeId === v.id);
				if (m.cascade !== true && chapters.length > 0) {
					throw new Error(`卷 ${v.id} 仍含 ${chapters.length} 章——需 cascade:true 级联删除（含各章段落选择，段落保留）`);
				}
				const deleted: Array<{ kind: string; id: string; data: unknown }> = [];
				const delSel = this.db.prepare("DELETE FROM chapter_paragraphs WHERE chapter_id = ?");
				const delChapter = this.db.prepare("DELETE FROM chapters WHERE id = ?");
				for (const c of chapters) {
					delSel.run(c.id);
					delChapter.run(c.id);
					deleted.push({ kind: "chapter", id: c.id, data: c });
				}
				this.db.prepare("DELETE FROM volumes WHERE id = ?").run(v.id);
				deleted.push({ kind: "volume", id: v.id, data: v });
				return this.result(v.entityVersion, v.id, "publication", deleted);
			}
			case "publication.chapter.create": {
				const c: PublicationChapter = {
					id: this.resolveId("chapters", m.id, "ch", "chapter") as never,
					entityVersion: 1,
					volumeId: m.volumeId,
					orderKey: m.orderKey ?? nextOrderKey(this.maxOrderKey("chapters WHERE volume_id IS ?", m.volumeId ?? null)),
					title: m.title,
					storyUnitId: m.storyUnitId,
					paragraphIds: [],
				} as PublicationChapter;
				// 校验前置：任何写库前完成（裸 mutate 无事务，失败不得留下章行或已提版本）
				if (m.paragraphIds !== undefined) {
					this.assertParagraphsExist(m.paragraphIds);
				}
				this.db
					.prepare("INSERT INTO chapters (id, entity_version, volume_id, order_key, title, story_unit_id) VALUES (?, ?, ?, ?, ?, ?)")
					.run(c.id, c.entityVersion, c.volumeId ?? null, c.orderKey, c.title, c.storyUnitId ?? null);
				if (m.paragraphIds !== undefined) {
					this.replaceSelection(c.id, m.paragraphIds as unknown as string[]);
				}
				return this.result(c.entityVersion, c.id, "publication");
			}
			case "publication.chapter.update": {
				const c = this.getChapter(m.chapterId);
				this.checkRevision(c.entityVersion, m.baseRevision, c.id);
				// 校验前置：先于版本提升与选择替换（失败不消耗版本号、不留半替换选择）
				if (m.patch.paragraphIds !== undefined) {
					this.assertParagraphsExist(m.patch.paragraphIds ?? []);
				}
				this.db
					.prepare("UPDATE chapters SET title = ?, volume_id = ?, order_key = ?, entity_version = ? WHERE id = ?")
					.run(m.patch.title ?? c.title, m.patch.volumeId ?? c.volumeId ?? null, m.patch.orderKey ?? c.orderKey, c.entityVersion + 1, c.id);
				if (m.patch.paragraphIds !== undefined) {
					this.replaceSelection(c.id, (m.patch.paragraphIds ?? []) as unknown as string[]);
				}
				return this.result(c.entityVersion + 1, c.id, "publication");
			}
			case "publication.chapter.delete": {
				const c = this.getChapter(m.chapterId);
				this.checkRevision(c.entityVersion, m.baseRevision, c.id);
				const selection = this.loadSelections().get(c.id) ?? [];
				if (m.cascade !== true && selection.length > 0) {
					throw new Error(`章 ${c.id} 仍有 ${selection.length} 个段落选择——需 cascade:true（级联仅解绑选择，段落保留）或先清空选择`);
				}
				this.db.prepare("DELETE FROM chapter_paragraphs WHERE chapter_id = ?").run(c.id);
				this.db.prepare("DELETE FROM chapters WHERE id = ?").run(c.id);
				return this.result(c.entityVersion, c.id, "publication", [
					{ kind: "chapter", id: c.id, data: c },
				]);
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
	private listParagraphs(storyUnitId?: string): Paragraph[] {
		// storyUnitId 缺省 = 全部（按单元分组、组内按 order_key）
		const sql =
			storyUnitId === undefined
				? "SELECT * FROM paragraphs ORDER BY story_unit_id, order_key"
				: "SELECT * FROM paragraphs WHERE story_unit_id = ? ORDER BY order_key";
		const rows = (
			storyUnitId === undefined
				? this.db.prepare(sql).all()
				: this.db.prepare(sql).all(storyUnitId)
		) as unknown as Row[];
		return rows.map(toParagraph);
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
		const selections = this.loadSelections();
		return (this.db.prepare("SELECT * FROM chapters").all() as unknown as Row[]).map((row) =>
			toChapter(row, selections.get(row.id as string) ?? []),
		);
	}
	private getChapter(id: string): PublicationChapter {
		const row = this.db.prepare("SELECT * FROM chapters WHERE id = ?").get(id) as unknown as Row | undefined;
		if (!row) throw new Error(`未找到 chapter: ${id}`);
		return toChapter(row, this.loadSelections().get(id) ?? []);
	}

	/** 章选择全量（chapter_id → 有序 paragraph_id） */
	private loadSelections(): Map<string, string[]> {
		const rows = this.db
			.prepare("SELECT chapter_id, paragraph_id FROM chapter_paragraphs ORDER BY chapter_id, position")
			.all() as unknown as Array<{ chapter_id: string; paragraph_id: string }>;
		const map = new Map<string, string[]>();
		for (const r of rows) {
			const list = map.get(r.chapter_id) ?? [];
			list.push(r.paragraph_id);
			map.set(r.chapter_id, list);
		}
		return map;
	}

	/** 节奏标注列迁移：旧库 paragraphs 缺 rhythm/intensity → ADD COLUMN 带默认值（旧行=hold/3） */
	private migrateParagraphBeatColumns(): void {
		const columns = new Set(
			(this.db.prepare("PRAGMA table_info(paragraphs)").all() as unknown as Array<{ name: string }>).map(
				(c) => c.name,
			),
		);
		if (!columns.has("rhythm")) {
			this.db.exec("ALTER TABLE paragraphs ADD COLUMN rhythm TEXT NOT NULL DEFAULT 'hold'");
		}
		if (!columns.has("intensity")) {
			this.db.exec("ALTER TABLE paragraphs ADD COLUMN intensity INTEGER NOT NULL DEFAULT 3");
		}
	}

	/** P3 一次性迁移：存量 chapter.story_unit_id 指针展开为该单元全部段落的选择，随后清空指针 */
	private migrateChapterSelections(): void {
		const chapters = this.db
			.prepare("SELECT id, story_unit_id FROM chapters WHERE story_unit_id IS NOT NULL")
			.all() as unknown as Array<{ id: string; story_unit_id: string }>;
		for (const c of chapters) {
			const existing = this.db
				.prepare("SELECT COUNT(*) AS n FROM chapter_paragraphs WHERE chapter_id = ?")
				.get(c.id) as { n: number };
			if (existing.n > 0) continue;
			const paragraphs = this.db
				.prepare("SELECT id FROM paragraphs WHERE story_unit_id = ? ORDER BY order_key")
				.all(c.story_unit_id) as unknown as Array<{ id: string }>;
			this.replaceSelection(c.id, paragraphs.map((p) => p.id));
			// 选择由指针展开为显式列表（语义变更）→ 版本 +1，旧 baseRevision 的写入（如重启审批重放）会被 stale 拦截
			this.db
				.prepare("UPDATE chapters SET story_unit_id = NULL, entity_version = entity_version + 1 WHERE id = ?")
				.run(c.id);
		}
	}

	/** 全量替换章选择（空数组即清空） */
	private replaceSelection(chapterId: string, paragraphIds: readonly string[]): void {
		this.db.prepare("DELETE FROM chapter_paragraphs WHERE chapter_id = ?").run(chapterId);
		let pos = 0;
		const insert = this.db.prepare("INSERT INTO chapter_paragraphs (chapter_id, paragraph_id, position) VALUES (?, ?, ?)");
		for (const pid of paragraphIds) insert.run(chapterId, pid, pos++);
	}

	/** 章选择引用校验：段落存在且无重复（重复会撞 chapter_paragraphs 主键；须在任何写之前拦截） */
	private assertParagraphsExist(paragraphIds: readonly string[]): void {
		if (new Set(paragraphIds).size !== paragraphIds.length) {
			throw new Error("章段落选择含重复 id");
		}
		for (const pid of paragraphIds) this.getParagraph(pid);
	}

	/** 段落从所有章选择移除；选择发生变化的章 entityVersion+1（选择变更须反映到版本，乐观锁语义一致） */
	private removeParagraphSelections(paragraphId: string): void {
		const rows = this.db
			.prepare("SELECT DISTINCT chapter_id FROM chapter_paragraphs WHERE paragraph_id = ?")
			.all(paragraphId) as unknown as Array<{ chapter_id: string }>;
		if (rows.length === 0) return;
		this.db.prepare("DELETE FROM chapter_paragraphs WHERE paragraph_id = ?").run(paragraphId);
		const bump = this.db.prepare("UPDATE chapters SET entity_version = entity_version + 1 WHERE id = ?");
		for (const r of rows) bump.run(r.chapter_id);
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
		const cur = this.getStoryUnit(id);
		const blockJson =
			patch.blockState === undefined
				? (cur.blockState ? JSON.stringify(cur.blockState) : null)
				: patch.blockState === null
					? null
					: JSON.stringify(patch.blockState);
		const abandonJson =
			patch.abandonment === undefined
				? (cur.abandonment ? JSON.stringify(cur.abandonment) : null)
				: patch.abandonment === null
					? null
					: JSON.stringify(patch.abandonment);
		this.db
			.prepare(
				"UPDATE story_units SET title = ?, intent = ?, synopsis = ?, scope = ?, planning_status = ?, realization_status = ?, parent_id = ?, order_key = ?, block_state = ?, abandonment = ?, entity_version = ? WHERE id = ?",
			)
			.run(
				(patch.title as string | undefined) ?? cur.title,
				(patch.intent as string | undefined) ?? cur.intent ?? null,
				(patch.synopsis as string | undefined) ?? cur.synopsis ?? null,
				(patch.scope as string | undefined) ?? cur.scope ?? null,
				(patch.planningStatus as string | undefined) ?? cur.planningStatus,
				(patch.realizationStatus as string | undefined) ?? cur.realizationStatus,
				// parentId：null = 移到根（NULL），未提供保留
				patch.parentId === undefined ? (cur.parentId ?? null) : ((patch.parentId as string | null) ?? null),
				(patch.orderKey as string | undefined) ?? cur.orderKey,
				blockJson,
				abandonJson,
				version, id,
			);
	}

	/** 覆盖保存 leaf 计划 */
	private saveLeafPlan(storyUnitId: string, plan: LeafPlan): void {
		this.db
			.prepare("INSERT OR REPLACE INTO leaf_story_unit_plans (story_unit_id, plan_json) VALUES (?, ?)")
			.run(storyUnitId, JSON.stringify(plan));
	}

	/** leaf 计划补丁应用：null 删整计划；字段级替换（null 清对应集合）；无既有计划以缺省基底起步 */
	private applyLeafPatch(storyUnitId: string, patch: LeafPlanPatch | null): void {
		if (patch === null) {
			this.db.prepare("DELETE FROM leaf_story_unit_plans WHERE story_unit_id = ?").run(storyUnitId);
			return;
		}
		const row = this.db
			.prepare("SELECT plan_json FROM leaf_story_unit_plans WHERE story_unit_id = ?")
			.get(storyUnitId) as { plan_json: string } | undefined;
		const base: LeafPlan = row
			? (JSON.parse(row.plan_json) as LeafPlan)
			: { settingMode: "located", characters: [], locations: [], events: [], rhythmBeats: [], entityChanges: [] };
		const next: LeafPlan = {
			settingMode: patch.settingMode ?? base.settingMode,
			time: patch.time === undefined ? base.time : (patch.time ?? undefined),
			characters: patch.characters === undefined ? base.characters : (patch.characters ?? []),
			locations: patch.locations === undefined ? base.locations : (patch.locations ?? []),
			events: patch.events === undefined ? base.events : (patch.events ?? []),
			rhythmBeats: patch.rhythmBeats === undefined ? base.rhythmBeats : (patch.rhythmBeats ?? []),
			entityChanges: patch.entityChanges === undefined ? base.entityChanges : (patch.entityChanges ?? []),
		};
		this.saveLeafPlan(storyUnitId, next);
	}

	/** units 附 leaf 计划 + 叶完成度 rollup（includePlans 读路径） */
	private attachLeafAndProgress(units: StoryUnit[]): Array<StoryUnitWithLeaf> {
		const plans = new Map(
			(
				this.db.prepare("SELECT story_unit_id, plan_json FROM leaf_story_unit_plans").all() as unknown as Array<{
					story_unit_id: string;
					plan_json: string;
				}>
			).map((r) => [r.story_unit_id, JSON.parse(r.plan_json) as LeafPlan]),
		);
		const childrenOf = new Map<string | undefined, StoryUnit[]>();
		for (const u of units) {
			const key = u.parentId;
			const list = childrenOf.get(key) ?? [];
			list.push(u);
			childrenOf.set(key, list);
		}
		const rollup = (unit: StoryUnit): { completed: number; total: number; blocked: boolean } => {
			let completed = 0;
			let total = 0;
			let blocked = unit.blockState !== undefined;
			for (const child of childrenOf.get(unit.id) ?? []) {
				const sub = rollup(child);
				completed += sub.completed;
				total += sub.total;
				blocked = blocked || sub.blocked;
			}
			if (plans.has(unit.id)) {
				total += 1;
				if (unit.realizationStatus === "completed") completed += 1;
			}
			return { completed, total, blocked };
		};
		return units.map((u) => {
			const { completed, total, blocked } = rollup(u);
			const effectiveStatus = blocked
				? "blocked"
				: u.abandonment !== undefined
					? "abandoned"
					: total > 0 && completed === total
						? "completed"
						: completed > 0
							? "in-progress"
							: u.realizationStatus;
			return {
				...u,
				...(plans.has(u.id) ? { leaf: plans.get(u.id) } : {}),
				progress: { effectiveStatus, isBlocked: blocked, completedLeafCount: completed, totalLeafCount: total },
			};
		});
	}
	private createEntity(
		table: "characters" | "locations",
		id: string | undefined,
		input: { name: string; aliases?: readonly string[]; summary?: string; initialState?: string; authorNotes?: string },
		entity: NovelChangeEntity,
	): NovelMutateResult {
		const now = new Date().toISOString();
		const resolved = this.resolveId(table, id, entity === "character" ? "char" : "loc", entity);
		this.db
			.prepare(`INSERT INTO ${table} (id, entity_version, name, aliases, summary, initial_state, author_notes, created_at, updated_at) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?)`)
			.run(resolved, input.name, JSON.stringify(input.aliases ?? []), input.summary ?? null, input.initialState ?? null, input.authorNotes ?? null, now, now);
		return this.result(1, resolved, entity);
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

	/** 解析创建 id：自选（pattern 校验 + 占用检查抛 duplicate_id）或宿主生成 */
	private resolveId(table: string, provided: string | undefined, prefix: string, label: string): string {
		if (provided === undefined) return nextId(prefix);
		if (!new RegExp(ID_PATTERN).test(provided)) {
			throw new Error(`id 不合规（须匹配 ${ID_PATTERN}）: ${provided}`);
		}
		const row = this.db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(provided);
		if (row !== undefined) throw new NovelDuplicateIdError(provided, label);
		return provided;
	}

	/** 兄弟集合内最大 order_key（字典序；fromClause 含 WHERE，参数可为 null——`IS ?` 匹配 NULL） */
	private maxOrderKey(fromClause: string, ...params: (string | null)[]): string | undefined {
		const row = this.db.prepare(`SELECT MAX(order_key) AS k FROM ${fromClause}`).get(...params) as
			| { k: string | null }
			| undefined;
		return row?.k ?? undefined;
	}

	/** 批量变更（批内原子）：单事务顺序执行，任一项失败回滚并抛错。
	 * 循环不 await（applyMutation 纯同步）——BEGIN→COMMIT 期间不让出事件循环，
	 * 并发 mutate/mutateBatch 自然串行：杜绝嵌套 BEGIN 报错与裸 mutate 加入他批事务被连带回滚。 */
	async mutateBatch(ms: readonly NovelMutation[]): Promise<NovelMutateResult[]> {
		this.db.exec("BEGIN");
		try {
			const results: NovelMutateResult[] = [];
			for (const m of ms) results.push(this.applyMutation(m));
			this.db.exec("COMMIT");
			return results;
		} catch (err) {
			this.db.exec("ROLLBACK");
			throw err;
		}
	}

	/** 构造 mutate 结果（级联删除时附完整记录） */
	private result(
		version: number,
		changeId: string,
		entity: NovelChangeEntity,
		deleted?: ReadonlyArray<{ kind: string; id: string; data: unknown }>,
	): NovelMutateResult {
		return deleted === undefined ? { version, changeId, entity } : { version, changeId, entity, deleted };
	}
}

// ── 行映射 ──
type Row = Record<string, unknown>;

function toStoryUnit(row: Row): StoryUnit {
	return {
		id: row.id as string,
		entityVersion: row.entity_version as number,
		outlineId: row.outline_id as string,
		parentId: (row.parent_id as string | null) ?? undefined,
		orderKey: row.order_key as string,
		title: row.title as string,
		// 可空列读归一：SQLite NULL → undefined（裸断言会把 null 透传到 UI，
		// `synopsis.replace` 类调用对 null 崩——导入锚点单元等无 synopsis 场景必现）
		intent: (row.intent as string | null) ?? undefined,
		synopsis: (row.synopsis as string | null) ?? undefined,
		scope: (row.scope as StoryUnit["scope"] | null) ?? undefined,
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
		// 可空列读归一（同 toStoryUnit）
		summary: (row.summary as string | null) ?? undefined,
		initialState: (row.initial_state as string | null) ?? undefined,
		authorNotes: (row.author_notes as string | null) ?? undefined,
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
		// 迁移默认值兜底：列带 DEFAULT，正常路径不触发；手工构造的行才可能缺
		rhythm: (row.rhythm as Paragraph["rhythm"]) ?? "hold",
		intensity: (row.intensity as number) ?? 3,
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

function toChapter(row: Row, paragraphIds: readonly string[] = []): PublicationChapter {
	return {
		id: row.id as string,
		entityVersion: row.entity_version as number,
		volumeId: (row.volume_id as string | null) ?? undefined,
		orderKey: row.order_key as string,
		title: row.title as string,
		storyUnitId: (row.story_unit_id as string | null) ?? undefined,
		paragraphIds,
	} as PublicationChapter;
}
