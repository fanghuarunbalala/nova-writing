import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger } from "../pino.js";

const tempDirs: string[] = [];

/** 建一个临时日志目录并登记清理 */
function tempLogDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "novel-log-test-"));
	tempDirs.push(dir);
	return dir;
}

/** 读取日志目录里生成的日志文件内容（每进程一个文件） */
function readLog(dir: string): string {
	const file = readdirSync(dir).find((f) => f.endsWith(".log"))!;
	return readFileSync(join(dir, file), "utf8");
}

afterEach(() => {
	while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

describe("createLogger", () => {
	it("文件命名：conversation-<id>-<pid>.log", async () => {
		const dir = tempLogDir();
		const logger = await createLogger({
			name: "conversation",
			id: "conv-123",
			logDir: dir,
		});
		logger.info("conversation.spawned");
		await logger.close();

		const file = readdirSync(dir).find((f) => f.endsWith(".log"));
		expect(file).toBeTruthy();
		expect(file).toMatch(/^conversation-conv-123-\d+\.log$/);
	});

	it("文件内容为可读文本行：时间 + 级别 + event + key=value，无 JSON 花括号", async () => {
		const dir = tempLogDir();
		const logger = await createLogger({
			name: "conversation",
			id: "conv-1",
			logDir: dir,
			level: "info",
		});
		logger.info("conversation.spawned", { conversationId: "conv-1", agentId: "novel.main" });
		logger.warn("journal.flush_slow", { ms: 42 });
		await logger.close();

		const lines = readLog(dir).trim().split("\n");
		expect(lines).toHaveLength(2);
		expect(lines[0]).toMatch(
			/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}\] INFO\s+conversation\.spawned/,
		);
		expect(lines[0]).toContain("conversationId=conv-1");
		expect(lines[0]).toContain("agentId=novel.main");
		expect(lines[0]).not.toContain("{");
		expect(lines[1]).toContain("WARN");
		expect(lines[1]).toContain("ms=42");
	});

	it("级别过滤：info 级别下 debug 不落盘", async () => {
		const dir = tempLogDir();
		const logger = await createLogger({
			name: "conversation",
			id: "conv-2",
			logDir: dir,
			level: "info",
		});
		logger.debug("subagent.started", { task: "read" });
		logger.info("subagent.finished", { task: "read" });
		await logger.close();

		const content = readLog(dir);
		expect(content).not.toContain("subagent.started");
		expect(content).toContain("subagent.finished");
	});

	it("child 绑定字段附加到子 logger 每一行", async () => {
		const dir = tempLogDir();
		const logger = await createLogger({
			name: "conversation",
			id: "conv-3",
			logDir: dir,
			level: "info",
		});
		const child = logger.child({ agentId: "sub-1" });
		child.info("subagent.started", { task: "read" });
		logger.info("no_sub");
		await logger.close();

		const lines = readLog(dir).trim().split("\n");
		expect(lines[0]).toContain("agentId=sub-1");
		expect(lines[0]).toContain("task=read");
		expect(lines[1]).not.toContain("agentId=sub-1");
	});

	it("stdout 纯净：日志内容不泄漏到 stdout", async () => {
		const dir = tempLogDir();
		const spy = vi.spyOn(process.stdout, "write");
		const logger = await createLogger({
			name: "conversation",
			id: "conv-4",
			logDir: dir,
			level: "info",
		});
		logger.info("conversation.spawned", { conversationId: "conv-4" });
		await logger.close();

		const stdoutOutput = spy.mock.calls.map((c) => String(c[0])).join("");
		expect(stdoutOutput).not.toContain("conversation.spawned");
		spy.mockRestore();
	});
});
