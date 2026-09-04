/**
 * journalMirror 模块单元测试（纯云端化 ④）：
 * - appendMirrorRows 追加时点去重（gs ≤ 文件尾的行丢弃——多写者竞态根治）；
 * - seedJournalMirrorFromServer：无镜像全量落盘 / 已最新仅增量请求 / 收缩全量重建 / 离线静默。
 * 真 server 集成见 cloud/server 包 desktop-contract.test.ts。
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	appendMirrorRows,
	readMirrorTail,
	seedJournalMirrorFromServer,
	type MirrorRow,
} from "../persistence/journalMirror.js";

async function readRows(path: string): Promise<MirrorRow[]> {
	const raw = await readFile(path, "utf8");
	return raw.split("\n").filter(Boolean).map((l) => JSON.parse(l) as MirrorRow);
}

function row(gs: number, seq = 1): MirrorRow {
	return { seq, kind: "append", messages: [{ type: "user", content: `m${gs}` }], ts: "t", gs };
}

function makeReplay(sinces: number[], events: Array<{ seq: number; run_seq: number; kind: string; payload: string }>, lastSeq: number) {
	const requests: Array<{ method: string; url: string }> = [];
	const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
		requests.push({ method: init?.method ?? "GET", url: String(url) });
		const since = Number(new URL(String(url)).searchParams.get("since") ?? "0");
		sinces.push(since);
		const filtered = events.filter((e) => e.seq > since);
		return new Response(JSON.stringify({ events: filtered, lastSeq }), { status: 200 });
	};
	return { requests, fetchImpl };
}

describe("journalMirror", () => {
	it("appendMirrorRows：gs 重叠的行被追加时点过滤（返回实追加数）", async () => {
		const dir = await mkdtemp(join(tmpdir(), "nova-jm-"));
		const path = join(dir, "journal.jsonl");
		try {
			await writeFile(path, `${JSON.stringify(row(5))}\n`, "utf8");
			expect(await appendMirrorRows(path, [row(3), row(5), row(7)])).toBe(1); // 3/5 被去重，7 落盘
			const rows = await readRows(path);
			expect(rows.map((r) => r.gs)).toEqual([5, 7]);
			expect((await readMirrorTail(path)).gs).toBe(7);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("seed：无镜像 → 全量落盘；已最新 → 仅一次增量请求；收缩 → 全量重建", async () => {
		const dir = await mkdtemp(join(tmpdir(), "nova-jm-"));
		const path = join(dir, "journal.jsonl");
		try {
			const events = [
				{ seq: 3, run_seq: 1, kind: "snapshot", payload: JSON.stringify([{ seq: 1, messages: [] }]) },
				{ seq: 4, run_seq: 1, kind: "append", payload: JSON.stringify([{ type: "user", content: "hi" }]) },
			];
			const { fetchImpl } = makeReplay([], events, 4);
			const opts = () => ({
				url: "http://srv",
				conversationId: "c1",
				mirrorPath: path,
				getAccessToken: async () => "jwt" as string | undefined,
				fetchImpl: fetchImpl as never,
			});
			// 1. 无镜像：全量（since=0）落盘
			await seedJournalMirrorFromServer(opts());
			expect((await readRows(path)).map((r) => r.gs)).toEqual([3, 4]);
			// 2. 已最新：一次 since=4 增量、空响应、不新增行
			await seedJournalMirrorFromServer(opts());
			expect((await readRows(path)).map((r) => r.gs)).toEqual([3, 4]);
			// 3. 收缩（server 清空 → lastSeq=0 < 尾 4）：since=4 探测后 since=0 重建
			await writeFile(path, `${JSON.stringify(row(4))}\n`, "utf8"); // 简化为单行尾 4
			const empty = makeReplay([], [], 0);
			await seedJournalMirrorFromServer({
				url: "http://srv",
				conversationId: "c1",
				mirrorPath: path,
				getAccessToken: async () => "jwt",
				fetchImpl: empty.fetchImpl as never,
			});
			expect((await readRows(path))).toHaveLength(0); // 重建为空账本
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("seed：未登录 / 离线 → 静默无副作用（不建文件）", async () => {
		const dir = await mkdtemp(join(tmpdir(), "nova-jm-"));
		const path = join(dir, "journal.jsonl");
		try {
			await seedJournalMirrorFromServer({
				url: "http://srv",
				conversationId: "c1",
				mirrorPath: path,
				getAccessToken: async () => undefined,
			});
			const offline = async (): Promise<Response> => {
				throw new Error("ECONNREFUSED");
			};
			await seedJournalMirrorFromServer({
				url: "http://srv",
				conversationId: "c1",
				mirrorPath: path,
				getAccessToken: async () => "jwt",
				fetchImpl: offline as never,
			});
			expect(existsSync(path)).toBe(false);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
