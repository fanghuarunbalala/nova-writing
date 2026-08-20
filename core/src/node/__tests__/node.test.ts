import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { NodeWorkspaceStoreLocator } from "../workspace/NodeWorkspaceStoreLocator.js";
import { WorkspaceDirLock } from "../workspace/WorkspaceDirLock.js";
import { NodeApplicationConfigStore } from "../config/NodeApplicationConfigStore.js";
import type { CredentialCipher } from "../../config/CredentialCipher.js";

describe("node 宿主", () => {
	it("NodeWorkspaceStoreLocator.resolve 派生 id + 可读 storeDir 名", async () => {
		const locator = new NodeWorkspaceStoreLocator({ storageRoot: "/root/storage" });
		const loc = await locator.resolve("/projects/novel");
		expect(loc.workspaceId).toHaveLength(12);
		// 目录名 = <父目录小写>-<项目名>--<hash8>（hash8 = workspaceId 前 8 位）
		expect(loc.storeDir).toBe(join("/root/storage", `projects-novel--${loc.workspaceId.slice(0, 8)}`));
	});

	it("NodeWorkspaceStoreLocator.resolve 中文路径 + Windows 非法字符清洗", async () => {
		const locator = new NodeWorkspaceStoreLocator({ storageRoot: "/root/storage" });
		const loc = await locator.resolve("C:\\Users\\u\\Downloads\\小说-debug-2");
		expect(basename(loc.storeDir)).toBe(`downloads-小说-debug-2--${loc.workspaceId.slice(0, 8)}`);
		// 盘符冒号等非法字符 → "-"，目录段不含 Windows 保留字符
		const unsafe = await locator.resolve("D:\\workplace\\我的:项目");
		expect(basename(unsafe.storeDir)).toBe(`workplace-我的-项目--${unsafe.workspaceId.slice(0, 8)}`);
		expect(basename(unsafe.storeDir)).not.toMatch(/[<>:"/\\|?*]/);
	});

	it("NodeApplicationConfigStore 落盘 + 重载（凭据经 cipher 加密）", async () => {
		const dir = await mkdtemp(join(tmpdir(), "novel-config-"));
		const filePath = join(dir, "config.json");
		const cipher: CredentialCipher = {
			encrypt: async (s: string) => `enc:${s}`,
			decrypt: async (s: string) => s.replace(/^enc:/, ""),
		};
		const store = new NodeApplicationConfigStore({ filePath, cipher });
		await store.load();
		await store.mutate({
			op: "model.upsert",
			profileId: "p1",
			profile: { provider: "openai", model: "m", credentialRef: "c1" },
		});
		await store.mutate({ op: "credential.save", ref: "c1", secret: "sk" });

		const store2 = new NodeApplicationConfigStore({ filePath, cipher });
		await store2.load();
		const snapshot = await store2.get();
		expect(snapshot.profiles).toHaveLength(1);
		expect(snapshot.credentials.c1).toBe("present");
	});
});

describe("WorkspaceDirLock（同项目进程锁）", () => {
	const identity = { workspaceId: "abc123", workspaceRoot: "/projects/novel" };

	it("首次获取成功；占用中二次获取被拒（持有 pid 存活）", async () => {
		const dir = await mkdtemp(join(tmpdir(), "novel-lock-"));
		const first = WorkspaceDirLock.acquire(dir, identity);
		if (first.status !== "acquired") throw new Error("首次获取应成功");
		expect(existsSync(first.lock.lockPath)).toBe(true);

		// 锁内 pid = 本测试进程（存活）→ 二次获取被拒，携带持有者 pid
		const second = WorkspaceDirLock.acquire(dir, identity);
		if (second.status !== "held") throw new Error("二次获取应被拒");
		expect(second.holderPid).toBe(process.pid);

		first.lock.release();
	});

	it("release 后可再次获取", async () => {
		const dir = await mkdtemp(join(tmpdir(), "novel-lock-"));
		const first = WorkspaceDirLock.acquire(dir, identity);
		if (first.status !== "acquired") throw new Error("首次获取应成功");
		first.lock.release();
		first.lock.release(); // 幂等
		const second = WorkspaceDirLock.acquire(dir, identity);
		if (second.status !== "acquired") throw new Error("释放后应可再获取");
		second.lock.release();
	});

	it("持有 pid 已死（崩溃残留）→ 回收锁后重试成功", async () => {
		const dir = await mkdtemp(join(tmpdir(), "novel-lock-"));
		// 拿一个确定已退出的 pid（spawnSync 等待子进程退出后才返回）
		const dead = spawnSync(process.execPath, ["-e", "process.exit(0)"], { timeout: 10_000 });
		expect(dead.status).toBe(0);
		writeFileSync(
			join(dir, "workspace.lock"),
			JSON.stringify({ ...identity, pid: dead.pid, acquiredAt: new Date().toISOString() }),
			"utf8",
		);
		const result = WorkspaceDirLock.acquire(dir, identity);
		if (result.status !== "acquired") throw new Error("死 pid 残留应被回收并获取成功");
		result.lock.release();
	});

	it("锁文件损坏（非法 JSON）→ 视为残留回收，获取成功", async () => {
		const dir = await mkdtemp(join(tmpdir(), "novel-lock-"));
		writeFileSync(join(dir, "workspace.lock"), "not-json", "utf8");
		const result = WorkspaceDirLock.acquire(dir, identity);
		if (result.status !== "acquired") throw new Error("损坏锁应被回收并获取成功");
		result.lock.release();
	});
});
