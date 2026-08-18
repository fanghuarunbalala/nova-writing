/**
 * 夹具包密闭自测（F1/F2）：构建核心（buildBookJson / buildFixturePackDir）的
 * 幂等/--force/模板/校验路径 + loadBookFixture 加载；全部 tmp 目录内完成，免 key。
 * 合成书 ywjs 入库夹具另有一条加载测试（缺夹具时 skip 并提示生成命令，对齐 F8 异常约定）。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildFixturePackDir } from "./fixture/build.js";
import { loadBookFixture, fixtureBooksRoot } from "./fixture/pack.js";
import { existsSync } from "node:fs";

const BOOK = [
	"第一章 甲",
	"第一段。",
	"第二段。",
	"",
	"第二章 乙",
	"第三段。",
	"第四段。",
].join("\n");

let root: string;
let sourcePath: string;

beforeAll(async () => {
	root = await mkdtemp(join(tmpdir(), "novel-fixture-test-"));
	sourcePath = join(root, "book.txt");
	await writeFile(sourcePath, BOOK, "utf8");
});

afterAll(async () => {
	await rm(root, { recursive: true, force: true }).catch(() => {});
});

describe("fixture 构建核心", () => {
	it("新建：解析层 + 模板生成；pid 全书递增且契约正确", async () => {
		const r = await buildFixturePackDir({ sourcePath, alias: "bkone", root });
		expect(r.created).toBe(true);
		expect(r.book.stats.chapters).toBe(2);
		expect(r.book.paragraphs).toHaveLength(2);
		expect(r.book.paragraphs[0]!.id).toBe("bkone-p000001");
		expect(r.book.paragraphs[1]!.id).toBe("bkone-p000002");
		expect(r.book.paragraphs[0]!.chapterNo).toBe(1);
		expect(existsSync(join(r.dir, "source.txt"))).toBe(true);
		expect(existsSync(join(r.dir, "fabricated", "style.md"))).toBe(true);
		expect(existsSync(join(r.dir, "ground-truth.json"))).toBe(true);
		// 模板 ground-truth 引用的 pid 必须合法（构建期校验已跑通 = 不抛）
	});

	it("幂等：source 哈希一致跳过（created=false）", async () => {
		const r = await buildFixturePackDir({ sourcePath, alias: "bkone", root });
		expect(r.created).toBe(false);
		expect(r.rebuilt).toBe(false);
	});

	it("哈希不一致且未 --force → 报错；--force 重建且保留作者产物", async () => {
		const changed = join(root, "book2.txt");
		await writeFile(changed, `${BOOK}\n\n第三章 丙\n第五段。\n`, "utf8");
		await expect(
			buildFixturePackDir({ sourcePath: changed, alias: "bkone", root }),
		).rejects.toThrow(/--force/);
		// 作者手改 ground-truth 后 force 重建：文件保留、校验照跑
		const gt = join(root, "bkone", "ground-truth.json");
		await writeFile(gt, JSON.stringify({ probe: "bkone-p000001" }), "utf8");
		const r = await buildFixturePackDir({ sourcePath: changed, alias: "bkone", root, force: true });
		expect(r.rebuilt).toBe(true);
		expect(r.book.stats.chapters).toBe(3);
		expect(await readFile(gt, "utf8")).toContain("bkone-p000001");
	});

	it("校验：ground-truth 悬空 pid 与非法 entities 在构建期报错", async () => {
		// 预写坏 ground-truth（build 保留作者文件）→ 构建期校验抛错
		await mkdir(join(root, "bktwo"), { recursive: true });
		await writeFile(
			join(root, "bktwo", "ground-truth.json"),
			JSON.stringify({ probe: "bktwo-p999999" }),
			"utf8",
		);
		await expect(
			buildFixturePackDir({ sourcePath, alias: "bktwo", root }),
		).rejects.toThrow(/不存在的 pid/);

		await mkdir(join(root, "bkthree", "fabricated"), { recursive: true });
		await writeFile(
			join(root, "bkthree", "fabricated", "entities.json"),
			// update 不存在的实体 → store require 抛错（未知 op 会被 switch 静默落空，测不出）
			JSON.stringify({
				mutations: [{ op: "outline.storyUnit.update", storyUnitId: "ghost", patch: {} }],
			}),
			"utf8",
		);
		await expect(
			buildFixturePackDir({ sourcePath, alias: "bkthree", root }),
		).rejects.toThrow();
	});

	it("别名非法与空书报错", async () => {
		await expect(
			buildFixturePackDir({ sourcePath, alias: "Bad_Alias", root }),
		).rejects.toThrow(/别名非法/);
		const empty = join(root, "empty.txt");
		await writeFile(empty, "   \n", "utf8");
		await expect(buildFixturePackDir({ sourcePath: empty, alias: "bkempty", root })).rejects.toThrow(
			/为空/,
		);
	});
});

describe("loadBookFixture", () => {
	it("加载构建产物（fabricated/ground-truth 可选件）", async () => {
		const pack = await loadBookFixture("bkone", root);
		expect(pack.alias).toBe("bkone");
		expect(pack.validParagraphIds.has("bkone-p000001")).toBe(true);
		expect(pack.groundTruth).not.toBeNull();
	});

	it("缺夹具明确报错（含生成命令提示）", async () => {
		await expect(loadBookFixture("missing", root)).rejects.toThrow(/fixture:build/);
	});

	it("合成书 ywjs 入库夹具可加载（缺则 skip 提示）", async () => {
		if (!existsSync(join(fixtureBooksRoot(), "ywjs", "book.json"))) {
			// F8 约定：依赖夹具的测试在缺夹具时显式 skip，不拖垮其余测试
			return;
		}
		const pack = await loadBookFixture("ywjs");
		expect(pack.book.stats.chapters).toBeGreaterThanOrEqual(10);
		expect(pack.validParagraphIds.has("ywjs-p000001")).toBe(true);
		expect(pack.fabricated.style).toContain("风格分析");
		expect((pack.groundTruth as { foreshadows?: unknown[] }).foreshadows?.length).toBeGreaterThanOrEqual(2);
	});
});
