/**
 * WorkspaceDirLock：同项目跨进程互斥锁（storeDir/workspace.lock）。
 * 「wx」排他创建保证原子性；崩溃残留由 pid 探活回收——锁内容里的持有进程已死
 * 即视为失效锁，删除后重试一次。多 GUI 实例并行时保证一个项目同一时刻仅被
 * 一个实例打开（工作区 novel.db 非 WAL，双开必然写冲突）。
 */

import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeSync } from "node:fs";
import { join } from "node:path";

/** 锁文件名（storeDir 内） */
const LOCK_FILE_NAME = "workspace.lock";

/** 锁内容（落盘 JSON；pid 为持有进程，acquiredAt 供人读） */
export interface WorkspaceLockContent {
	pid: number
	workspaceId: string
	workspaceRoot: string
	acquiredAt: string
}

/** acquire 结果：成功（附锁句柄）/ 被其他活进程持有 */
export type WorkspaceLockResult =
	| { status: "acquired"; lock: WorkspaceDirLock }
	| { status: "held"; holderPid: number; lockPath: string };

/** pid 存活探测（signal 0 不发信号只校验权限）：ESRCH = 已死；EPERM = 活着但无权限 */
function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (e) {
		return (e as NodeJS.ErrnoException).code === "EPERM";
	}
}

/** 原子排他创建并写入锁内容（已存在返回 false，其余错误上抛） */
function tryCreate(lockPath: string, content: WorkspaceLockContent): boolean {
	let fd: number;
	try {
		fd = openSync(lockPath, "wx");
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === "EEXIST") return false;
		throw e;
	}
	try {
		writeSync(fd, JSON.stringify(content));
	} finally {
		closeSync(fd);
	}
	return true;
}

/** 读锁内容（缺失/损坏返回 undefined） */
function readLock(lockPath: string): WorkspaceLockContent | undefined {
	try {
		const parsed = JSON.parse(readFileSync(lockPath, "utf8")) as Partial<WorkspaceLockContent>;
		if (typeof parsed.pid !== "number" || Number.isInteger(parsed.pid) === false) return undefined;
		return {
			pid: parsed.pid,
			workspaceId: typeof parsed.workspaceId === "string" ? parsed.workspaceId : "",
			workspaceRoot: typeof parsed.workspaceRoot === "string" ? parsed.workspaceRoot : "",
			acquiredAt: typeof parsed.acquiredAt === "string" ? parsed.acquiredAt : "",
		};
	} catch {
		return undefined;
	}
}

/** 同项目进程锁句柄（release 幂等；仅持有着删锁文件） */
export class WorkspaceDirLock {
	readonly lockPath: string
	private released = false

	private constructor(lockPath: string) {
		this.lockPath = lockPath;
	}

	/**
	 * 获取锁：原子创建；被活进程持有返回 held（含持有者 pid 与锁路径，供报错文案）；
	 * 持有进程已死 / 内容不可读视为崩溃残留，删除后重试一次
	 * @param storeDir 工作区存储目录（locator 派生，每项目唯一）
	 * @param identity 工作区标识（pid/acquiredAt 由本方法填充）
	 */
	static acquire(storeDir: string, identity: { workspaceId: string; workspaceRoot: string }): WorkspaceLockResult {
		mkdirSync(storeDir, { recursive: true });
		const lockPath = join(storeDir, LOCK_FILE_NAME);
		const content: WorkspaceLockContent = {
			...identity,
			pid: process.pid,
			acquiredAt: new Date().toISOString(),
		};
		if (tryCreate(lockPath, content)) return { status: "acquired", lock: new WorkspaceDirLock(lockPath) };
		const holder = readLock(lockPath);
		if (holder !== undefined && isProcessAlive(holder.pid)) {
			return { status: "held", holderPid: holder.pid, lockPath };
		}
		// 崩溃残留：回收后重试（重试仍撞说明回收窗口内有并发获得者，按 held 报）
		rmSync(lockPath, { force: true });
		if (tryCreate(lockPath, content)) return { status: "acquired", lock: new WorkspaceDirLock(lockPath) };
		return { status: "held", holderPid: holder?.pid ?? 0, lockPath };
	}

	/** 释放锁（删除锁文件；尽力而为，进程退出时由 pid 探活兜底回收） */
	release(): void {
		if (this.released) return;
		this.released = true;
		try {
			rmSync(this.lockPath, { force: true });
		} catch {
			// 尽力而为：残留锁会被下一个获取者按死 pid 回收
		}
	}
}
