/**
 * buildNovelAgent bundle 模式测试（M3 FR6，生产装配路径）：
 * - 有效包（golden）：systemSections 由包驱动（static 内容 = 包内文案）、
 *   工具审批覆盖生效、compact 策略带包参数基线；
 * - 能力缺口（包引用本地不存在的段）→ 回退 legacy 装配不抛错；
 * - 未传 bundle → 纯 legacy（现状零回归）。
 * 夹具来自 protocol/fixtures（双端共享单一来源）。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Provider } from "../../provider/Provider.js";
import type { NovelHandle } from "../../../novel/client/NovelHandle.js";
import type { DefinitionBundle } from "../../definition/bundle.js";
import type { AgentCapability } from "../AgentCapability.js";
import type { AgentLoop } from "../../loop/AgentLoop.js";
import { buildNovelAgent } from "../NovelAgent.js";

const FIXTURE = path.join(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
	"..",
	"..",
	"..",
	"..",
	"..",
	"protocol",
	"fixtures",
	"definition-novel-1.5.0.json",
);

function goldenBundle(): DefinitionBundle {
	return JSON.parse(readFileSync(FIXTURE, "utf8")) as DefinitionBundle;
}

const provider: Provider = {
	call: async () => ({ finishReason: "stop", message: { role: "assistant", content: "ok" } }),
};

const handle = {
	query: async (q: { op: string }) => (q.op === "characters.list" ? [] : {}),
	mutate: async () => ({ version: 1, changeId: "x", entity: "character" }),
} as unknown as NovelHandle;

function capabilityOf(loop: AgentLoop): AgentCapability {
	return (loop as unknown as { config: { agentCapability: AgentCapability } }).config.agentCapability;
}

/** LoopContext.renderStaticBase 等价渲染：static 段按序 join("\n") */
function renderStaticBase(capability: AgentCapability): string {
	return capability.systemSections
		.filter((s): s is { kind: "static"; render: () => string } => s.kind === "static")
		.map((s) => s.render(null as never))
		.join("\n");
}

describe("buildNovelAgent bundle 模式", () => {
	it("golden 包：static 段由包内容驱动（改包文案 → 装配结果随之变）", () => {
		const legacy = capabilityOf(buildNovelAgent({ workspace: "/ws", provider, handle }));
		const bundle = goldenBundle();
		// 篡改首个 static 段内容（模拟 server 下发新策略面）
		const firstStatic = bundle.prompt.recipe.find((r) => r.kind === "static") as { content: string };
		firstStatic.content = "【包驱动文案】你是 Nova Writing 的签约作者。";

		const bundled = capabilityOf(buildNovelAgent({ workspace: "/ws", provider, handle, bundle }));
		expect(renderStaticBase(bundled)).toContain("【包驱动文案】");
		expect(renderStaticBase(bundled)).not.toBe(renderStaticBase(legacy));
		// 段数与 recipe 一致（包序驱动）
		expect(bundled.systemSections.length).toBe(bundle.prompt.recipe.length);
		expect(legacy.systemSections.length).toBeGreaterThan(0);
	});

	it("工具审批覆盖：包 overrides 翻转 requireApproval", () => {
		const legacy = capabilityOf(buildNovelAgent({ workspace: "/ws", provider, handle }));
		const someTool = legacy.toolDefs.find((t) => t.name.length > 0)!;
		const before = someTool.requireApproval;

		const bundle = goldenBundle();
		bundle.tools = { ...(bundle.tools as object), overrides: { [someTool.name]: { requireApproval: !before } } } as DefinitionBundle["tools"];
		const bundled = capabilityOf(buildNovelAgent({ workspace: "/ws", provider, handle, bundle }));
		const after = bundled.toolDefs.find((t) => t.name === someTool.name)!.requireApproval;
		expect(after).toBe(!before);
		// 其余工具不受影响
		const other = legacy.toolDefs.find((t) => t.name !== someTool.name && t.requireApproval === before)!;
		expect(bundled.toolDefs.find((t) => t.name === other.name)!.requireApproval).toBe(before);
	});

	it("能力缺口（包引用不存在的渲染器）→ 回退 legacy 装配，不抛错", () => {
		const bundle = goldenBundle();
		const recipe = bundle.prompt.recipe.find((r) => r.kind === "dynamic") as { sectionId: string };
		recipe.sectionId = "renderer.ghost";

		const loop = buildNovelAgent({ workspace: "/ws", provider, handle, bundle });
		const legacyLoop = buildNovelAgent({ workspace: "/ws", provider, handle });
		// 回退 = 与 legacy 同源（静态 base 一致）
		expect(renderStaticBase(capabilityOf(loop))).toBe(renderStaticBase(capabilityOf(legacyLoop)));
	});

	it("compact 基线：包参数进入 AutoCompactPolicy（用户 opts.compact 仍可覆盖）", () => {
		const readT1 = (loop: unknown): number =>
			((loop as { config: { agentCapability: { compactPolicies: unknown[] } } }).config.agentCapability.compactPolicies[0] as { cfg: { t1Ratio: number } }).cfg.t1Ratio;
		const bundle = goldenBundle();
		const chain = bundle.compact.chain.find((c) => c.policyId === "t1-skeletonize")!;
		(chain.params as Record<string, unknown>).t1Ratio = 0.55;

		const loop = buildNovelAgent({ workspace: "/ws", provider, handle, bundle });
		expect(readT1(loop)).toBe(0.55);

		// 用户覆盖优先于包
		(chain.params as Record<string, unknown>).t1Ratio = 0.66;
		const loop2 = buildNovelAgent({ workspace: "/ws", provider, handle, bundle, compact: { t1Ratio: 0.8 } });
		expect(readT1(loop2)).toBe(0.8);
	});
});
