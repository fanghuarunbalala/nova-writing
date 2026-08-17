/**
 * Tier 0 确定性快照回归（docs/PRD/eval-harness.md §5）：
 * system prompt 全文（屏蔽动态日期行）+ section 序 + 全部 toolDefs 的
 * desc/schema/promptDetail 金样。任何 prompt/schema 改动都会在此显式 diff，
 * 杜绝无意漂移；有意改动须 `vitest -u` 更新快照并随 PR review。
 * 模板沿用 core/src/runtime/agent/__tests__/agent-render-e2e.test.ts 的装配先例。
 */
import { describe, it, expect } from "vitest";
import { buildNovelAgent, InMemoryNovelStore } from "@novel/core";
import type { Provider, NovelHandle, ToolDef } from "@novel/core";

const provider: Provider = {
	call: async () => ({ finishReason: "stop", message: { role: "assistant", content: "ok" } }),
	getModelInfo: (model: string) => ({
		model,
		supportsTemperature: true,
		thinkingMode: "none" as const,
		contextWindowTokens: 128_000,
	}),
};

/** 固定装配：workspace/platform/model/constraints 全部钉死，唯一动态量是日期行 → 屏蔽 */
function assemble() {
	const store = new InMemoryNovelStore();
	const handle = {
		query: (q: unknown) => store.query(q as never),
		mutate: (m: unknown) => store.mutate(m as never),
	} as unknown as NovelHandle;
	const loop = buildNovelAgent({
		workspace: "/ws",
		provider,
		handle,
		conversationId: "conv-snapshot",
		platform: "Windows",
		novelConstraintsProvider: async () => ({
			fileName: "NOVEL.md",
			content: "# 世界观\n- 基调热血",
		}),
	});
	return loop;
}

/** AgentLoop 私有装配的读取 cast（沿 agent-render-e2e / novel-agent 测试先例） */
type LoopInternals = {
	config: { agentCapability: { systemSections: Array<{ id: string; kind: string }>; toolDefs: ToolDef[] } };
	context: { systemPrompt: string };
};

async function renderPrompt() {
	const loop = assemble();
	await loop.run("hi", { sampling: { model: "gpt-5" } });
	const prompt = (loop as unknown as LoopInternals).context.systemPrompt;
	// 屏蔽 core.environment 动态段的日期行（含时区），其余全量进快照
	return prompt.replace(/^- 当前日期：.*$/gm, "- 当前日期：<masked>");
}

function capability() {
	return (assemble() as unknown as LoopInternals).config.agentCapability;
}

/** 快照用的 toolDef 投影：只保留会进 prompt / provider tools 的确定性字段 */
function toolProjection(t: ToolDef) {
	return {
		name: t.name,
		version: t.version,
		description: t.description,
		parameters: t.parameters,
		promptDetail: t.promptDetail,
		requireApproval: t.requireApproval,
	};
}

describe("Tier 0 快照：system prompt 渲染", () => {
	it("完整 system prompt 金样（静态 + 动态段全量）", async () => {
		expect(await renderPrompt()).toMatchSnapshot();
	});

	it("section 序金样（id + kind）", () => {
		const sections = capability().systemSections.map((s) => ({ id: s.id, kind: s.kind }));
		expect(sections).toMatchSnapshot();
	});
});

describe("Tier 0 快照：toolDefs（desc / schema / promptDetail）", () => {
	it("全部工具投影金样", () => {
		expect(capability().toolDefs.map(toolProjection)).toMatchSnapshot();
	});

	it("工具数量锁（12；误增删组/工具即暴露——novel.entities 合并后 5 组 12 件）", () => {
		expect(capability().toolDefs).toHaveLength(12);
	});
});

describe("Tier 0 自检：tool schema 卫生", () => {
	it("name 全局唯一", () => {
		const names = capability().toolDefs.map((t) => t.name);
		expect(new Set(names).size).toBe(names.length);
	});

	/**
	 * 存量欠账（probe 2026-08-17）：files/todo/compose 组 schema 极简，properties 无 description。
	 * 显式登记在案——新增工具/属性缺 description 即失败；补齐欠账后从清单移除并加严。
	 */
	const KNOWN_MISSING_DESCRIPTION = new Set([
		"TodoWrite#todos",
		"Read#file_path", "Read#offset", "Read#limit",
		"Glob#pattern",
		"Write#file_path", "Write#content",
		"Edit#file_path", "Edit#old_string", "Edit#new_string", "Edit#replace_all",
		"EnterComposeMode#purpose",
	]);

	it("parameters 形状合法（type=object）+ properties 缺 description 仅限登记欠账", () => {
		const missing: string[] = [];
		for (const t of capability().toolDefs) {
			const p = t.parameters as { type?: string; properties?: Record<string, { description?: unknown }> } | undefined;
			if (p === undefined) continue;
			if (p.type !== "object") missing.push(`${t.name}.parameters.type`);
			for (const [key, prop] of Object.entries(p.properties ?? {})) {
				const hasDescription = typeof prop.description === "string" && prop.description.length > 0;
				const known = KNOWN_MISSING_DESCRIPTION.has(`${t.name}#${key}`);
				if (!hasDescription && !known) missing.push(`${t.name}#${key}`);
			}
		}
		// 汇总报告：一次看全未登记的缺失，而非逐条断言中断
		expect(missing, `未登记的缺 description 属性：${missing.join(", ")}`).toEqual([]);
		// 反向锁：登记项若已补齐 description，须从清单移除（防清单腐烂）
		const repaid: string[] = [];
		for (const t of capability().toolDefs) {
			const p = t.parameters as { properties?: Record<string, { description?: unknown }> } | undefined;
			for (const [key, prop] of Object.entries(p?.properties ?? {})) {
				if (
					KNOWN_MISSING_DESCRIPTION.has(`${t.name}#${key}`) &&
					typeof prop.description === "string" &&
					prop.description.length > 0
				) {
					repaid.push(`${t.name}#${key}`);
				}
			}
		}
		expect(repaid, `已补齐 description，请从 KNOWN_MISSING_DESCRIPTION 移除：${repaid.join(", ")}`).toEqual([]);
	});
});
