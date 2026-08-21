import { describe, expect, it } from "vitest";
import { mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { zipSync } from "fflate";
import { InMemoryNovelStore } from "../../novel/InMemoryNovelStore.js";
import type { PublicationChapter, PublicationVolume } from "../../novel/model/publication.js";
import { ProjectImportService } from "../ProjectImportService.js";
import { batchFilePath, batchIdOf, importManifestPath, importMetaPath } from "../ImportPaths.js";
import type { ImportPlan, ImportPreview } from "../ImportTypes.js";

/** 造临时目录 */
function tmpRoot(): string {
	const dir = join(tmpdir(), `project-import-${randomUUID()}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

/** 多卷样例（卷标记 + 章标记；每章两自然段） */
const SAMPLE = [
	"第一卷 风起",
	"第一章 启程",
	"夜色落下，他提刀出门。",
	"街上无人，只有风声。",
	"第二章 转折",
	"雨停了，桥上有人等他。",
	"那人没有回头。",
	"第二卷 云涌",
	"第三章 重逢",
	"三年后，城头变换了大旗。",
	"他还认得那双眼睛。",
].join("\n");

function writeSampleTxt(root: string, text = SAMPLE): string {
	const path = join(root, "旧稿.txt");
	writeFileSync(path, text, "utf8");
	return path;
}

/** zip 样例：数字名乱序（1/10/2）验证自然排序 + 非 txt 跳过 */
function writeSampleZip(root: string): string {
	const files: Record<string, Uint8Array> = {
		"10.txt": strToU8("第十章 十\n十全十美。"),
		"2.txt": strToU8("第二章 二\n二话不说。"),
		"1.txt": strToU8("第一章 一\n一元复始。"),
		"notes.pdf": strToU8("%PDF- fake"),
		"__MACOSX/._1.txt": strToU8("junk"),
	};
	const path = join(root, "旧稿.zip");
	const zipped = zipSync(files, { level: 0 });
	writeFileSync(path, Buffer.from(zipped));
	return path;
}

function strToU8(text: string): Uint8Array {
	return new TextEncoder().encode(text);
}

/** 读 store 的卷章投影（标题 + 归属 + 章内段落文本） */
async function readStructure(store: InMemoryNovelStore) {
	const pub = (await store.query({ op: "publication.get" })) as {
		volumes: PublicationVolume[];
		chapters: PublicationChapter[];
	};
	const paragraphs = (await store.query({ op: "paragraphs.list" })) as Array<{
		id: string;
		text: string;
	}>;
	const textById = new Map(paragraphs.map((p) => [p.id, p.text]));
	return {
		volumes: pub.volumes.map((v) => v.title),
		chapters: pub.chapters.map((c) => ({
			title: c.title,
			volumeId: c.volumeId ?? null,
			texts: (c.paragraphIds ?? []).map((id) => textById.get(id) ?? `<缺段:${id}>`),
		})),
		volumeIdOf: (title: string) => pub.volumes.find((v) => v.title === title)?.id ?? null,
	};
}

describe("ProjectImportService", () => {
	it("prepare：卷章/字数预览（不落库不落盘）", async () => {
		const root = tmpRoot();
		try {
			const service = new ProjectImportService();
			const preview: ImportPreview = await service.prepare(writeSampleTxt(root));
			expect(preview.kind).toBe("txt");
			expect(preview.sourceName).toBe("旧稿.txt");
			expect(preview.volumes.map((v) => v.title)).toEqual(["第一卷 风起", "第二卷 云涌"]);
			expect(preview.chapters.map((c) => c.title)).toEqual([
				"第一章 启程",
				"第二章 转折",
				"第三章 重逢",
			]);
			expect(preview.chapters[0]!.volumeKey).toBe("v1");
			expect(preview.chapters[2]!.volumeKey).toBe("v2");
			expect(preview.totalChars).toBe(SAMPLE.length);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("apply：卷/章/段落按确认稿落库 + 拆分产物落盘 + import.json=analyzing", async () => {
		const root = tmpRoot();
		try {
			const service = new ProjectImportService();
			const sourcePath = writeSampleTxt(root);
			const plan: ImportPlan = await service.prepare(sourcePath);
			const workspaceRoot = join(root, "proj");
			mkdirSync(workspaceRoot, { recursive: true });
			const store = new InMemoryNovelStore();
			const events: Array<{ stage: string; done: number; total: number }> = [];
			const stats = await service.apply({
				workspaceRoot,
				store,
				sourcePath,
				plan,
				onProgress: (p) => events.push({ ...p }),
			});

			expect(stats).toEqual({
				volumes: 2,
				chapters: 3,
				paragraphs: 9,
				batches: 3,
				chars: SAMPLE.length,
			});
			// 阶段进度序列：reading → parsing → writing-files(1..3/3) → writing-db(n/n)
			expect(events[0]?.stage).toBe("reading");
			expect(events[1]?.stage).toBe("parsing");
			const fileEvents = events.filter((e) => e.stage === "writing-files");
			expect(fileEvents).toHaveLength(3);
			expect(fileEvents.at(-1)).toMatchObject({ done: 3, total: 3 });
			const dbEvents = events.filter((e) => e.stage === "writing-db");
			expect(dbEvents.length).toBeGreaterThan(0);
			expect(dbEvents.at(-1)).toMatchObject({ done: dbEvents.at(-1)?.total });

			const structure = await readStructure(store);
			expect(structure.volumes).toEqual(["第一卷 风起", "第二卷 云涌"]);
			expect(structure.chapters[0]).toEqual({
				title: "第一章 启程",
				volumeId: structure.volumeIdOf("第一卷 风起"),
				// 章标记行余文（"启程"）作为首段保留——正文逐字一致
				texts: ["启程", "夜色落下，他提刀出门。", "街上无人，只有风声。"],
			});
			expect(structure.chapters[2]!.volumeId).toBe(structure.volumeIdOf("第二卷 云涌"));
			// 正文逐字一致
			expect(structure.chapters[1]!.texts).toEqual(["转折", "雨停了，桥上有人等他。", "那人没有回头。"]);

			// 预建全书根 saga（ProjectImporter 的幕一律挂其下）+ 段落锚点
			const outline = (await store.query({ op: "outline.get" })) as {
				units: Array<{ id: string; title: string; scope?: string; parentId?: string; orderKey: string }>;
			};
			const saga = outline.units.find((u) => u.id === "imp-saga");
			expect(saga).toMatchObject({
				title: "旧稿", // 源文件名（旧稿.txt）去扩展名
				scope: "saga",
				parentId: undefined,
				orderKey: "0002",
			});
			expect(outline.units.find((u) => u.id === "imp-anchor")).toBeDefined();

			// 拆分产物：批次文件 + manifest + import.json
			const batch1 = readFileSync(batchFilePath(workspaceRoot, batchIdOf(1)), "utf8");
			expect(batch1).toBe("启程\n\n夜色落下，他提刀出门。\n\n街上无人，只有风声。");
			const manifest = readFileSync(importManifestPath(workspaceRoot), "utf8");
			expect(manifest.split("\n").filter((l) => l.trim() !== "")).toHaveLength(3);
			expect(JSON.parse(manifest.split("\n")[0]!)).toMatchObject({
				id: "imp-b000001",
				chapterNo: 1,
				chapterTitle: "第一章 启程",
			});
			const meta = JSON.parse(readFileSync(importMetaPath(workspaceRoot), "utf8")) as {
				status: string;
			};
			expect(meta.status).toBe("analyzing");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("apply：预览微调生效（改章标题 + 章移卷）", async () => {
		const root = tmpRoot();
		try {
			const service = new ProjectImportService();
			const sourcePath = writeSampleTxt(root);
			const plan: ImportPlan = await service.prepare(sourcePath);
			// 微调：第三章改名并移入第一卷；第一卷改名
			plan.chapters[2]!.title = "第三章 重逢（修订）";
			plan.chapters[2]!.volumeKey = "v1";
			plan.volumes[0]!.title = "第一卷 风云再起";
			const workspaceRoot = join(root, "proj");
			mkdirSync(workspaceRoot, { recursive: true });
			const store = new InMemoryNovelStore();
			await service.apply({ workspaceRoot, store, sourcePath, plan });
			const structure = await readStructure(store);
			expect(structure.volumes[0]).toBe("第一卷 风云再起");
			expect(structure.chapters[2]).toMatchObject({ title: "第三章 重逢（修订）" });
			expect(structure.chapters[2]!.volumeId).toBe(structure.volumeIdOf("第一卷 风云再起"));
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("apply：计划与解析不一致被拒（改文件后旧计划失效）", async () => {
		const root = tmpRoot();
		try {
			const service = new ProjectImportService();
			const sourcePath = writeSampleTxt(root);
			const plan: ImportPlan = await service.prepare(sourcePath);
			writeSampleTxt(root, `${SAMPLE}\n多了一行正文。`);
			const store = new InMemoryNovelStore();
			await expect(
				service.apply({ workspaceRoot: join(root, "proj"), store, sourcePath, plan }),
			).rejects.toThrow(/不一致/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("apply：非空项目被拒", async () => {
		const root = tmpRoot();
		try {
			const service = new ProjectImportService();
			const sourcePath = writeSampleTxt(root);
			const plan: ImportPlan = await service.prepare(sourcePath);
			const store = new InMemoryNovelStore();
			await store.mutate({ op: "publication.volume.create", title: "已有卷" });
			await expect(
				service.apply({ workspaceRoot: join(root, "proj"), store, sourcePath, plan }),
			).rejects.toThrow(/不为空/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("zip：多 txt 自然排序拼接 + 非 txt 跳过列入 skippedFiles", async () => {
		const root = tmpRoot();
		try {
			const service = new ProjectImportService();
			const preview = await service.prepare(writeSampleZip(root));
			expect(preview.kind).toBe("zip");
			expect(preview.chapters.map((c) => c.title)).toEqual(["第一章 一", "第二章 二", "第十章 十"]);
			expect(preview.skippedFiles).toContain("notes.pdf");
			expect(preview.skippedFiles).not.toContain("__MACOSX/._1.txt");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("progress：outline 覆盖信号 + journal 信号取最大；无导入记录为 none", async () => {
		const root = tmpRoot();
		try {
			const service = new ProjectImportService();
			const sourcePath = writeSampleTxt(root);
			const plan: ImportPlan = await service.prepare(sourcePath);
			const workspaceRoot = join(root, "proj");
			mkdirSync(workspaceRoot, { recursive: true });
			const store = new InMemoryNovelStore();
			await service.apply({ workspaceRoot, store, sourcePath, plan });

			// 初始：无覆盖信号
			const initial = await service.progress(workspaceRoot, store);
			expect(initial.status).toBe("analyzing");
			expect(initial.indeterminate).toBe(true);
			expect(initial.totalBatches).toBe(3);

			// agent 写入带覆盖标记的大纲单元 → 覆盖到第 3 批
			await store.mutate({
				op: "outline.storyUnit.create",
				title: "幕一",
				scope: "arc",
				synopsis: "开端（覆盖 imp-b000001–imp-b000003）",
			});
			const covered = await service.progress(workspaceRoot, store);
			expect(covered.indeterminate).toBe(false);
			expect(covered.coveredBatches).toBe(3);
			expect(covered.percent).toBe(100);
			expect(covered.unitCount).toBeGreaterThanOrEqual(2); // 锚点 + 幕一

			// journal 信号（Read 批次 2）领先于 outline（无标记的单元）时取 journal
			const store2 = new InMemoryNovelStore();
			const root2 = join(root, "proj2");
			mkdirSync(root2, { recursive: true });
			await service.apply({ workspaceRoot: root2, store: store2, sourcePath, plan: await service.prepare(sourcePath) });
			const journalPath = join(root2, "journal.jsonl");
			writeFileSync(journalPath, '... Read paragraphs/imp-b000002.md ...', "utf8");
			const byJournal = await service.progress(root2, store2, journalPath);
			expect(byJournal.coveredBatches).toBe(2);
			expect(byJournal.percent).toBe(67);

			// 无导入记录 → none
			expect((await service.progress(join(root, "empty"), store)).status).toBe("none");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("progress：analyzing 超 10 分钟无 journal 更新 → stalled（疑似卡住）", async () => {
		const root = tmpRoot();
		try {
			const service = new ProjectImportService();
			const sourcePath = writeSampleTxt(root);
			const plan = await service.prepare(sourcePath);
			const workspaceRoot = join(root, "proj");
			mkdirSync(workspaceRoot, { recursive: true });
			const store = new InMemoryNovelStore();
			await service.apply({ workspaceRoot, store, sourcePath, plan });
			// 新鲜状态（journal 未建，退回 import.json updatedAt=刚刚）：不卡
			expect((await service.progress(workspaceRoot, store)).stalled).toBeUndefined();
			// journal 存在但 mtime 拖到 11 分钟前：疑似卡住（status 仍 analyzing）
			const journalPath = join(workspaceRoot, "journal.jsonl");
			writeFileSync(journalPath, "{}\n", "utf8");
			const old = new Date(Date.now() - 11 * 60_000);
			utimesSync(journalPath, old, old);
			const stalled = await service.progress(workspaceRoot, store, journalPath);
			expect(stalled.status).toBe("analyzing");
			expect(stalled.stalled).toBe(true);
			// journal 恢复新鲜：不再判定卡住
			utimesSync(journalPath, new Date(), new Date());
			expect((await service.progress(workspaceRoot, store, journalPath)).stalled).toBeUndefined();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("markStatus：置 failed 带 reason；重试置 analyzing 清 reason", async () => {
		const root = tmpRoot();
		try {
			const service = new ProjectImportService();
			const sourcePath = writeSampleTxt(root);
			const plan: ImportPlan = await service.prepare(sourcePath);
			const workspaceRoot = join(root, "proj");
			mkdirSync(workspaceRoot, { recursive: true });
			await service.apply({ workspaceRoot, store: new InMemoryNovelStore(), sourcePath, plan });
			await service.markStatus(workspaceRoot, { status: "failed", statusReason: "模型未配置" });
			expect((await service.readMeta(workspaceRoot))?.statusReason).toBe("模型未配置");
			await service.markStatus(workspaceRoot, { status: "analyzing" });
			const meta = await service.readMeta(workspaceRoot);
			expect(meta?.status).toBe("analyzing");
			expect(meta?.statusReason).toBeUndefined();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
