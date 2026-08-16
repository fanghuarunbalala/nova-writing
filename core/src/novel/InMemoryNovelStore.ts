/**
 * InMemoryNovelStore：内存版 NovelStore（跑通 RPC 垂直切片）。
 * 乐观锁：update/delete 校验 baseRevision === 实体 entityVersion，stale 拒绝；成功后 entityVersion++。
 * P1 对齐 legacy：创建可自选 id（duplicate_id 拒绝）；orderKey 缺省生成末位兄弟后继；
 * paragraph.update 为 PATCH；paragraphs.list 可全量；mutateBatch 批内原子（快照回滚）。
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

/** 批内原子回滚用的状态快照（七张 Map 深拷贝） */
interface NovelStateSnapshot {
	characters: Map<string, Character>;
	locations: Map<string, Location>;
	storyUnits: Map<string, StoryUnit>;
	paragraphs: Map<string, Paragraph>;
	volumes: Map<string, PublicationVolume>;
	chapters: Map<string, PublicationChapter>;
	leafPlans: Map<string, LeafPlan>;
	chapterSelections: Map<string, string[]>;
}

/** 内存版 novel 存储（query 读 / mutate 写 + revision 乐观锁） */
export class InMemoryNovelStore implements NovelStore {
	private readonly characters = new Map<string, Character>();
	private readonly locations = new Map<string, Location>();
	private readonly storyUnits = new Map<string, StoryUnit>();
	private readonly paragraphs = new Map<string, Paragraph>();
	private readonly volumes = new Map<string, PublicationVolume>();
	private readonly chapters = new Map<string, PublicationChapter>();
	private readonly leafPlans = new Map<string, LeafPlan>();
	/** 章选择：chapter_id → 有序 paragraph_id（P3 选择模型） */
	private readonly chapterSelections = new Map<string, string[]>();
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
			case "outline.get": {
				const units = [...this.storyUnits.values()];
				return q.includePlans === true
					? { outline: this.outline, units: this.attachLeafAndProgress(units) }
					: { outline: this.outline, units };
			}
			case "outline.storyUnit.get": {
				const unit = this.require(this.storyUnits, q.storyUnitId, "story unit");
				return q.includePlans === true ? this.attachLeafAndProgress([unit])[0] : unit;
			}
			case "characters.list":
				return [...this.characters.values()];
			case "characters.get":
				return this.require(this.characters, q.characterId, "character");
			case "locations.list":
				return [...this.locations.values()];
			case "locations.get":
				return this.require(this.locations, q.locationId, "location");
			case "paragraphs.list":
				if (q.storyUnitId !== undefined) {
					return [...this.paragraphs.values()]
						.filter((p) => p.storyUnitId === q.storyUnitId)
						.sort((a, b) => a.orderKey.localeCompare(b.orderKey));
				}
				// 全量：按单元分组（单元 id 字典序），组内按 orderKey
				return [...this.paragraphs.values()].sort(
					(a, b) =>
						(a.storyUnitId < b.storyUnitId ? -1 : a.storyUnitId > b.storyUnitId ? 1 : 0) ||
						a.orderKey.localeCompare(b.orderKey),
				);
			case "paragraph.get":
				return this.require(this.paragraphs, q.paragraphId, "paragraph");
			case "publication.get":
				return {
					structure: {} as PublicationStructure,
					volumes: [...this.volumes.values()],
					chapters: [...this.chapters.values()].map((c) => ({
						...c,
						paragraphIds: [...(this.chapterSelections.get(c.id) ?? [])],
					})),
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
			// ── 大纲 ──
			case "outline.storyUnit.create": {
				const su: StoryUnit = {
					id: this.resolveId(this.storyUnits, m.id, "su", "story unit") as never,
					entityVersion: 1,
					outlineId: this.outline.id,
					parentId: m.parentId,
					orderKey: m.orderKey ?? nextOrderKey(this.maxSiblingOrderKey([...this.storyUnits.values()].filter((u) => u.parentId === m.parentId).map((u) => u.orderKey))),
					title: m.title,
					intent: m.intent,
					synopsis: m.synopsis,
					scope: m.scope,
					planningStatus: m.planningStatus ?? "idea",
					realizationStatus: m.realizationStatus ?? "pending",
					blockState: m.blockState,
					abandonment: m.abandonment,
				};
				this.storyUnits.set(su.id, su);
				if (m.leaf !== undefined) this.leafPlans.set(su.id, m.leaf);
				return this.result(su.entityVersion, su.id, "outline");
			}
			case "outline.storyUnit.update": {
				const su = this.require(this.storyUnits, m.storyUnitId, "story unit");
				this.checkRevision(su.entityVersion, m.baseRevision, su.id);
				const { parentId, blockState, abandonment, leaf, ...rest } = m.patch;
				Object.assign(su, rest);
				// parentId 单独处理：null = 移到根（清除），未提供保留
				if (parentId !== undefined) su.parentId = parentId ?? undefined;
				if (blockState !== undefined) su.blockState = blockState ?? undefined;
				if (abandonment !== undefined) su.abandonment = abandonment ?? undefined;
				if (leaf !== undefined) this.applyLeafPatch(su.id, leaf);
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
				const collect = (unit: StoryUnit, acc: StoryUnit[]): StoryUnit[] => {
					acc.push(unit);
					for (const child of [...this.storyUnits.values()].filter((u) => u.parentId === unit.id)) {
						collect(child, acc);
					}
					return acc;
				};
				const subtree = collect(su, []);
				if (m.cascade !== true) {
					const childCount = subtree.length - 1;
					const hasLeaf = this.leafPlans.has(su.id);
					const paraCount = [...this.paragraphs.values()].filter((p) => p.storyUnitId === su.id).length;
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
				for (const unit of subtree) {
					const plan = this.leafPlans.get(unit.id);
					if (plan !== undefined) {
						deleted.push({ kind: "leaf_plan", id: unit.id, data: plan });
						this.leafPlans.delete(unit.id);
					}
					for (const p of [...this.paragraphs.values()].filter((pp) => pp.storyUnitId === unit.id)) {
						this.removeParagraphSelections(p.id);
						this.paragraphs.delete(p.id);
						deleted.push({ kind: "paragraph", id: p.id, data: p });
					}
					this.storyUnits.delete(unit.id);
					deleted.push({ kind: "story_unit", id: unit.id, data: unit });
				}
				return this.result(su.entityVersion, su.id, "outline", deleted);
			}
			// ── 角色 ──
			case "character.create":
				return this.createEntity(this.characters, m.id, m.input, "character");
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
				return this.createEntity(this.locations, m.id, m.input, "location");
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
					id: this.resolveId(this.paragraphs, m.id, "para", "paragraph") as never,
					entityVersion: 1,
					storyUnitId: m.storyUnitId,
					orderKey: m.orderKey ?? nextOrderKey(this.maxSiblingOrderKey([...this.paragraphs.values()].filter((p) => p.storyUnitId === m.storyUnitId).map((p) => p.orderKey))),
					text: m.text,
				};
				this.paragraphs.set(p.id, p);
				return this.result(p.entityVersion, p.id, "paragraph");
			}
			case "paragraph.update": {
				const p = this.require(this.paragraphs, m.paragraphId, "paragraph");
				this.checkRevision(p.entityVersion, m.baseRevision, p.id);
				if (m.text !== undefined) p.text = m.text;
				if (m.storyUnitId !== undefined) p.storyUnitId = m.storyUnitId;
				if (m.orderKey !== undefined) p.orderKey = m.orderKey;
				p.entityVersion++;
				return this.result(p.entityVersion, p.id, "paragraph");
			}
			case "paragraph.delete": {
				const p = this.require(this.paragraphs, m.paragraphId, "paragraph");
				this.checkRevision(p.entityVersion, m.baseRevision, p.id);
				this.removeParagraphSelections(p.id);
				this.paragraphs.delete(p.id);
				return this.result(p.entityVersion, p.id, "paragraph");
			}
			// ── 发布 ──
			case "publication.volume.create": {
				const v: PublicationVolume = {
					id: this.resolveId(this.volumes, m.id, "vol", "volume") as never,
					entityVersion: 1,
					orderKey: m.orderKey ?? nextOrderKey(this.maxSiblingOrderKey([...this.volumes.values()].map((v) => v.orderKey))),
					title: m.title,
				};
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
				const chapters = [...this.chapters.values()].filter((c) => c.volumeId === v.id);
				if (m.cascade !== true && chapters.length > 0) {
					throw new Error(`卷 ${v.id} 仍含 ${chapters.length} 章——需 cascade:true 级联删除（含各章段落选择，段落保留）`);
				}
				const deleted: Array<{ kind: string; id: string; data: unknown }> = [];
				for (const c of chapters) {
					this.chapterSelections.delete(c.id);
					this.chapters.delete(c.id);
					deleted.push({ kind: "chapter", id: c.id, data: c });
				}
				this.volumes.delete(v.id);
				deleted.push({ kind: "volume", id: v.id, data: v });
				return this.result(v.entityVersion, v.id, "publication", deleted);
			}
			case "publication.chapter.create": {
				const c: PublicationChapter = {
					id: this.resolveId(this.chapters, m.id, "ch", "chapter") as never,
					entityVersion: 1,
					volumeId: m.volumeId,
					orderKey: m.orderKey ?? nextOrderKey(this.maxSiblingOrderKey([...this.chapters.values()].filter((c) => c.volumeId === m.volumeId).map((c) => c.orderKey))),
					title: m.title,
					storyUnitId: m.storyUnitId,
					paragraphIds: [],
				};
				// 校验前置：任何写之前完成（失败不留章实体，与 Sqlite 实现统一报错语义）
				if (m.paragraphIds !== undefined) {
					this.validateSelection(m.paragraphIds);
				}
				this.chapters.set(c.id, c);
				if (m.paragraphIds !== undefined) {
					this.replaceSelection(c.id, m.paragraphIds);
				}
				return this.result(c.entityVersion, c.id, "publication");
			}
			case "publication.chapter.update": {
				const c = this.require(this.chapters, m.chapterId, "chapter");
				this.checkRevision(c.entityVersion, m.baseRevision, c.id);
				const { paragraphIds, ...rest } = m.patch;
				// 校验前置：先于对象修改（失败不留部分写）
				if (paragraphIds !== undefined) {
					this.validateSelection(paragraphIds ?? []);
				}
				Object.assign(c, rest);
				if (paragraphIds !== undefined) {
					this.replaceSelection(c.id, paragraphIds ?? []);
				}
				c.entityVersion++;
				return this.result(c.entityVersion, c.id, "publication");
			}
			case "publication.chapter.delete": {
				const c = this.require(this.chapters, m.chapterId, "chapter");
				this.checkRevision(c.entityVersion, m.baseRevision, c.id);
				const selection = this.chapterSelections.get(c.id) ?? [];
				if (m.cascade !== true && selection.length > 0) {
					throw new Error(`章 ${c.id} 仍有 ${selection.length} 个段落选择——需 cascade:true（级联仅解绑选择，段落保留）或先清空选择`);
				}
				this.chapterSelections.delete(c.id);
				this.chapters.delete(c.id);
				return this.result(c.entityVersion, c.id, "publication", [
					{ kind: "chapter", id: c.id, data: c },
				]);
			}
		}
	}

	/** 批量变更（批内原子）：逐项执行，任一项失败恢复快照并抛错（循环不 await，执行期间不让出事件循环） */
	async mutateBatch(ms: readonly NovelMutation[]): Promise<NovelMutateResult[]> {
		const snapshot = this.snapshotState();
		try {
			const results: NovelMutateResult[] = [];
			for (const m of ms) results.push(this.applyMutation(m));
			return results;
		} catch (err) {
			this.restoreState(snapshot);
			throw err;
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

	/** 解析创建 id：自选（pattern 校验 + 占用检查）或宿主生成 */
	private resolveId(map: Map<string, unknown>, provided: string | undefined, prefix: string, label: string): string {
		if (provided === undefined) return nextId(prefix);
		if (!new RegExp(ID_PATTERN).test(provided)) {
			throw new Error(`id 不合规（须匹配 ${ID_PATTERN}）: ${provided}`);
		}
		if (map.has(provided)) throw new NovelDuplicateIdError(provided, label);
		return provided;
	}

	/** 兄弟集合内最大 orderKey（字典序） */
	private maxSiblingOrderKey(keys: readonly string[]): string | undefined {
		return keys.length === 0 ? undefined : keys.reduce((a, b) => (b > a ? b : a));
	}

	/** 创建实体（Character/Location 同构） */
	private createEntity(
		map: Map<string, Character> | Map<string, Location>,
		id: string | undefined,
		input: { name: string; aliases?: readonly string[]; summary?: string; initialState?: string; authorNotes?: string },
		entity: NovelChangeEntity,
	): NovelMutateResult {
		const now = new Date().toISOString();
		const e = {
			id: this.resolveId(map as Map<string, unknown>, id, entity === "character" ? "char" : "loc", entity) as never,
			entityVersion: 1,
			name: input.name,
			aliases: input.aliases ?? [],
			summary: input.summary,
			initialState: input.initialState,
			authorNotes: input.authorNotes,
			createdAt: now,
			updatedAt: now,
		};
		if (entity === "character") {
			this.characters.set(e.id, e as unknown as Character);
		} else {
			this.locations.set(e.id, e as unknown as Location);
		}
		return this.result(e.entityVersion, e.id, entity);
	}

	/** 变更结果（novel.changed 广播载荷；级联删除时附完整记录） */
	private result(
		version: number,
		id: string,
		entity: NovelChangeEntity,
		deleted?: ReadonlyArray<{ kind: string; id: string; data: unknown }>,
	): NovelMutateResult {
		return deleted === undefined ? { version, changeId: id, entity } : { version, changeId: id, entity, deleted };
	}

	/** 章选择校验：引用段落存在且无重复（与 Sqlite 实现统一报错语义；调用方须在任何写之前校验） */
	private validateSelection(paragraphIds: readonly string[]): void {
		if (new Set(paragraphIds).size !== paragraphIds.length) {
			throw new Error("章段落选择含重复 id");
		}
		for (const pid of paragraphIds) this.require(this.paragraphs, pid, "paragraph");
	}

	/** 全量替换章选择（空数组即清空；引用校验由 validateSelection 前置完成） */
	private replaceSelection(chapterId: string, paragraphIds: readonly string[]): void {
		this.chapterSelections.set(chapterId, [...paragraphIds]);
	}

	/** 段落从所有章选择移除；选择发生变化的章 entityVersion+1（选择变更须反映到版本，乐观锁语义一致） */
	private removeParagraphSelections(paragraphId: string): void {
		for (const [chapterId, ids] of this.chapterSelections) {
			const next = ids.filter((id) => id !== paragraphId);
			if (next.length === ids.length) continue;
			this.chapterSelections.set(chapterId, next);
			const c = this.chapters.get(chapterId);
			if (c !== undefined) c.entityVersion++;
		}
	}

	/** leaf 计划补丁应用：null 删整计划；字段级替换（null 清对应集合）；无既有计划以缺省基底起步 */
	private applyLeafPatch(storyUnitId: string, patch: LeafPlanPatch | null): void {
		if (patch === null) {
			this.leafPlans.delete(storyUnitId);
			return;
		}
		const base: LeafPlan = this.leafPlans.get(storyUnitId) ?? {
			settingMode: "located",
			characters: [],
			locations: [],
			events: [],
			rhythmBeats: [],
			entityChanges: [],
		};
		this.leafPlans.set(storyUnitId, {
			settingMode: patch.settingMode ?? base.settingMode,
			time: patch.time === undefined ? base.time : (patch.time ?? undefined),
			characters: patch.characters === undefined ? base.characters : (patch.characters ?? []),
			locations: patch.locations === undefined ? base.locations : (patch.locations ?? []),
			events: patch.events === undefined ? base.events : (patch.events ?? []),
			rhythmBeats: patch.rhythmBeats === undefined ? base.rhythmBeats : (patch.rhythmBeats ?? []),
			entityChanges: patch.entityChanges === undefined ? base.entityChanges : (patch.entityChanges ?? []),
		});
	}

	/** units 附 leaf 计划 + 叶完成度 rollup（includePlans 读路径） */
	private attachLeafAndProgress(units: StoryUnit[]): Array<StoryUnitWithLeaf> {
		const childrenOf = new Map<string | undefined, StoryUnit[]>();
		for (const u of [...this.storyUnits.values()]) {
			const list = childrenOf.get(u.parentId) ?? [];
			list.push(u);
			childrenOf.set(u.parentId, list);
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
			if (this.leafPlans.has(unit.id)) {
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
				...(this.leafPlans.has(u.id) ? { leaf: this.leafPlans.get(u.id) } : {}),
				progress: { effectiveStatus, isBlocked: blocked, completedLeafCount: completed, totalLeafCount: total },
			};
		});
	}

	/** 深拷贝当前状态（批内原子回滚基线） */
	private snapshotState(): NovelStateSnapshot {
		const clone = <V>(m: Map<string, V>): Map<string, V> =>
			new Map([...m].map(([k, v]) => [k, structuredClone(v)]));
		return {
			characters: clone(this.characters),
			locations: clone(this.locations),
			storyUnits: clone(this.storyUnits),
			paragraphs: clone(this.paragraphs),
			volumes: clone(this.volumes),
			chapters: clone(this.chapters),
			leafPlans: clone(this.leafPlans),
			chapterSelections: clone(this.chapterSelections),
		};
	}

	/** 恢复快照（清空重灌） */
	private restoreState(s: NovelStateSnapshot): void {
		const restore = <V>(dst: Map<string, V>, src: Map<string, V>): void => {
			dst.clear();
			for (const [k, v] of src) dst.set(k, v);
		};
		restore(this.characters, s.characters);
		restore(this.locations, s.locations);
		restore(this.storyUnits, s.storyUnits);
		restore(this.paragraphs, s.paragraphs);
		restore(this.volumes, s.volumes);
		restore(this.chapters, s.chapters);
		restore(this.leafPlans, s.leafPlans);
		restore(this.chapterSelections, s.chapterSelections);
	}
}
