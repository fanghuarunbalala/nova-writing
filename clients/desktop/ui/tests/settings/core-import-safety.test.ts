/**
 * core 根入口导入安全（白屏防回归）：
 * ui 的运行时值导入必须走 browser-safe 的 `@novel/core/client`（或 /node 子路径，
 * 仅限非 renderer 消费）。根入口 re-export zeromq/pino 等 node 依赖，被 vite
 * 打进 renderer 后浏览器环境抛 `__dirname is not defined` → 启动白屏。
 * 本类错误编译期不可见（tsc 正常），只能靠源码扫描守门。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC_ROOT = join(import.meta.dirname, "..", "..", "src");

function* walk(dir: string): Generator<string> {
	for (const name of readdirSync(dir)) {
		const full = join(dir, name);
		if (statSync(full).isDirectory()) yield* walk(full);
		else if (/\.(ts|tsx)$/.test(name)) yield full;
	}
}

/** 提取 import 声明中 @novel/core 根入口（非 /client、/node 子路径）的值绑定 */
function rootValueImports(source: string): string[] {
	const offenders: string[] = [];
	// import ... from "@novel/core"（不含子路径）；逐条判定是否 type-only
	const re = /import\s+([^;]+?)\s+from\s+"@novel\/core"/g;
	for (const match of source.matchAll(re)) {
		const clause = match[1]!;
		if (clause.trim().startsWith("type ")) continue; // import type {...} —— 编译期擦除
		const inner = clause.match(/\{([\s\S]*)\}/)?.[1] ?? "";
		const values = inner
			.split(",")
			.map((part) => part.trim())
			.filter((part) => part !== "" && !part.startsWith("type ")); // 内联 type 修饰同样擦除
		if (values.length > 0) offenders.push(`import ${clause} from "@novel/core"`);
	}
	return offenders;
}

describe("core 根入口导入安全", () => {
	it("src 下不存在 @novel/core 根入口的运行时值导入（type-only 允许）", () => {
		const offenders: string[] = [];
		for (const file of walk(SRC_ROOT)) {
			const found = rootValueImports(readFileSync(file, "utf8"));
			for (const statement of found) {
				offenders.push(`${file.replace(SRC_ROOT, "src")}: ${statement}`);
			}
		}
		expect(offenders).toEqual([]);
	});
});
