/**
 * case 语料结构自测（密闭，无 API key）：
 * 只加载 cases/*.case.ts 的纯 CaseSpec（不触碰 *.eval.ts——evalite 在模块加载时
 * 即向 vitest 注册真实测试，只有 evalite 运行器才应加载注册壳）。
 * ① 数量/命名（15 个、唯一非空）② 断言 ≥1 且对兜底 metrics 求值不抛异常
 * ③ seed NovelMutation 落库合法（全新 InMemoryNovelStore mutateBatch）。
 */
import { describe, it, expect } from "vitest";
import { InMemoryNovelStore } from "@novel/core";
import type { CaseSpec } from "./compile.js";
import { evalCase, failedMetrics } from "./dsl.js";

declare global {
	// 本地声明（未直接依赖 vite/client 类型）：import.meta.glob 由 vitest 转换提供
	interface ImportMeta {
		glob(pattern: string, opts?: { eager?: boolean }): Record<string, unknown>;
	}
}

const modules = import.meta.glob("../cases/*.case.ts", { eager: true });
const specs = Object.values(modules).map((m) => (m as { spec: CaseSpec }).spec);

describe("case 语料结构自测", () => {
	it("注册了 15 个 case，name 唯一非空", () => {
		expect(specs).toHaveLength(15);
		const names = specs.map((s) => s.name);
		expect(new Set(names).size).toBe(names.length);
		for (const name of names) {
			expect(name.length, `case 名为空：${name}`).toBeGreaterThan(0);
		}
	});

	it("每个 case 断言 ≥1，且对兜底 metrics 求值不抛异常（判定为 boolean）", async () => {
		const fallback = failedMetrics(new Error("结构自测"));
		for (const spec of specs) {
			const builder = evalCase(spec.input);
			spec.configure(builder);
			const defs = builder.defs();
			expect(defs.length, `${spec.name} 无断言`).toBeGreaterThanOrEqual(1);
			for (const d of defs) {
				const verdict = await d.evaluate(fallback);
				expect(typeof verdict.passed, `${spec.name}/${d.name}.passed`).toBe("boolean");
				expect(typeof verdict.actual, `${spec.name}/${d.name}.actual`).toBe("string");
			}
		}
	});

	it("每个 case 的 seed 均可落库（NovelMutation 形状合法）", async () => {
		for (const spec of specs) {
			const seed = spec.input.seed?.novel;
			if (seed === undefined || seed.length === 0) continue;
			const store = new InMemoryNovelStore();
			await expect(
				store.mutateBatch(seed),
				`${spec.name} seed 落库失败（op 形状非法）`,
			).resolves.toBeTruthy();
		}
	});
});
