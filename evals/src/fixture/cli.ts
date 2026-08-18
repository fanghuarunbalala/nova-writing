/**
 * fixture:build CLI（F1）：node dist/fixture/cli.js <book.txt> <别名> [--force] [--title 书名]
 * 幂等构建夹具包解析层 + 缺失模板生成 + 构建期校验（pid 存在性 / entities 落库形状）。
 */
import { fileURLToPath } from "node:url";
import { buildFixturePackDir } from "./build.js";

async function main(): Promise<void> {
	const argv = process.argv.slice(2).filter((a) => a !== "--");
	const force = argv.includes("--force");
	const titleIndex = argv.indexOf("--title");
	const title = titleIndex >= 0 ? argv[titleIndex + 1] : undefined;
	const positional = argv.filter((a, i) => a !== "--force" && i !== titleIndex && i !== titleIndex + 1);
	const [sourcePath, alias] = positional;
	if (sourcePath === undefined || alias === undefined) {
		console.error("用法：fixture:build -- <book.txt> <别名> [--force] [--title 书名]");
		console.error("  别名 kebab-case；产物入 fixtures/books/<别名>/（真实书 gitignore）");
		process.exit(2);
	}
	const result = await buildFixturePackDir({
		sourcePath,
		alias,
		force,
		...(title !== undefined ? { title } : {}),
	});
	const state = result.created ? "新建" : result.rebuilt ? "force 重建" : "幂等跳过（哈希一致）";
	console.log(
		`[fixture] ${state}: ${result.dir}（卷 ${result.book.stats.volumes} / 章 ${result.book.stats.chapters} / 分段 ${result.book.stats.batches} / ${result.book.stats.chars} 字）`,
	);
}

// CLI 入口守卫：被测试 import（buildFixturePackDir）时不得触发顶层 main
if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
	await main();
}
