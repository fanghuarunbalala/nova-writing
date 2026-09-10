import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createComposeTools } from "../definitions/compose.js";
import { ComposeModeService, ComposeModeStateProvider } from "../../../conversation/compose/index.js";

/** 造一个 ToolCall 形状的最小对象 */
function call(name: string, args: Record<string, unknown>) {
	return { id: "tc-1", name, args: JSON.stringify(args) };
}

describe("novel.compose 工具", () => {
	let dir: string;
	let service: ComposeModeService;
	let tools: ReturnType<typeof createComposeTools>;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "novel-compose-tools-"));
		service = new ComposeModeService({
			composeState: new ComposeModeStateProvider(),
			designRoot: join(dir, "ws", ".novel", "design"),
		});
		tools = createComposeTools(service, "c1");
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("工具集 = EnterComposeMode（免审）+ ExitComposeMode（硬审批门）", () => {
		expect(tools.map((t) => t.name)).toEqual(["EnterComposeMode", "ExitComposeMode"]);
		expect(tools[0]?.requireApproval).toBeUndefined();
		expect(tools[1]?.requireApproval).toBe(true);
	});

	it("Enter：进入 compose，结果含 workspace 相对路径 + 5 阶段工作流", async () => {
		const [enter] = tools;
		const text = await enter!.handler.execute(call("EnterComposeMode", {}));
		expect(text).toContain("Compose mode entered. Design file: .novel/design/c1.md");
		expect(text).toContain("# 设计模式（Compose Mode）");
		expect(text).toContain("### Phase 5: 提交审批");
		expect(text).not.toContain(dir); // 不泄漏绝对路径
	});

	it("Enter 幂等：重复调用 alreadyActive 文案且文件内容保留", async () => {
		const [enter] = tools;
		await enter!.handler.execute(call("EnterComposeMode", { purpose: "first" }));
		writeFileSync(join(dir, "ws", ".novel", "design", "c1.md"), "draft", "utf8");
		const text = await enter!.handler.execute(call("EnterComposeMode", {}));
		expect(text).toContain("Compose mode is already active.");
		expect(text).toContain(".novel/design/c1.md");
	});

	it("Exit：审批通过后归档草稿，结果含退出回显", async () => {
		const [enter, exit] = tools;
		await enter!.handler.execute(call("EnterComposeMode", {}));
		const path_ = join(dir, "ws", ".novel", "design", "c1.md");
		writeFileSync(path_, "final", "utf8");
		const text = await exit!.handler.execute(call("ExitComposeMode", {}));
		expect(text).toContain("Compose mode exited.");
		expect(text).toContain("# 设计模式已结束");
		expect(existsSync(path_)).toBe(false);
		expect(existsSync(join(dir, "ws", ".novel", "design", "archive", "c1.md"))).toBe(true);
	});

	it("Exit 非 active 时安全网：不抛错，返回退出文案", async () => {
		const [, exit] = tools;
		const text = await exit!.handler.execute(call("ExitComposeMode", {}));
		expect(text).toContain("Compose mode exited.");
	});

	it("参数非法：purpose 超长 / JSON 非法均抛错", async () => {
		const [enter] = tools;
		await expect(
			enter!.handler.execute(call("EnterComposeMode", { purpose: "x".repeat(513) })),
		).rejects.toThrow("purpose 超长");
		await expect(
			enter!.handler.execute({ id: "tc-2", name: "EnterComposeMode", args: "{bad" }),
		).rejects.toThrow("无效的 JSON 参数");
	});
});
