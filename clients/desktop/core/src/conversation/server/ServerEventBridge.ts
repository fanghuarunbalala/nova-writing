/**
 * ServerEventBridge：server SSE 订阅桥（PRD 桌面接入 FR3）。
 * - GET /v1/events?conversationId&since&access_token（EventSource 无法带 header，server 支持查询参数）；
 * - since 游标 = 本地已见最大账本 seq（journal 事件自动推进；断线重连幂等补拉）；
 * - 重连退避 1s/2s/5s/10s 封顶（连接成功归零）；心跳注释行忽略；
 * - approval_* / lease_* / journal_* / journal_rewritten 事件原样分发（各自处理器接线在 FR4/FR5）。
 */

/** server 推送的流事件（journal/approval/lease/ready 等；字段以 type 为判别） */
export type ServerStreamEvent = { type: string } & Record<string, unknown>;

/** 可注入 fetch（测试；须支持流式 body 读取） */
export type StreamFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface ServerEventBridgeOptions {
	/** server 基址 */
	url: string;
	/** JWT access（每（重）连时现取；查询参数携带） */
	getAccessToken: () => Promise<string | undefined>;
	/** 订阅的 conversation（缺省全量流） */
	conversationId?: string;
	/** 初始 since 游标 */
	initialSince?: number;
	/** 事件分发（ready/journal/approval_resolved/…） */
	onEvent: (event: ServerStreamEvent) => void;
	/** 可注入 fetch */
	fetchImpl?: StreamFetch;
	/** 连接状态回调（UI 指示 / 日志） */
	onStateChange?: (state: "connecting" | "open" | "closed") => void;
}

/** SSE 帧重连退避序列（ms；超出封顶重复末值） */
const BACKOFF_STEPS_MS = [1_000, 2_000, 5_000, 10_000];

export class ServerEventBridge {
	private readonly opts: ServerEventBridgeOptions;
	private readonly fetchImpl: StreamFetch;
	private since: number;
	private stopped = false;
	private loopPromise: Promise<void> | undefined;
	/** 当前连接的取消器（stop 时中断挂起的 fetch/流读取，否则 runLoop 卡在读流里无法退出） */
	private abortController: AbortController | undefined;
	/** 测试钩子：等待下一次重连调度 */
	protected nextSchedule: () => void = () => {};

	constructor(opts: ServerEventBridgeOptions) {
		this.opts = opts;
		this.fetchImpl = opts.fetchImpl ?? ((i, j) => fetch(i, j));
		this.since = opts.initialSince ?? 0;
	}

	/** 当前游标（外部持久化恢复用） */
	get cursor(): number {
		return this.since;
	}

	start(): void {
		if (this.loopPromise !== undefined) return;
		this.stopped = false;
		this.loopPromise = this.runLoop();
	}

	async stop(): Promise<void> {
		this.stopped = true;
		this.abortController?.abort();
		await this.loopPromise;
		this.loopPromise = undefined;
		this.opts.onStateChange?.("closed");
	}

	private async runLoop(): Promise<void> {
		let backoffIndex = 0;
		while (!this.stopped) {
			this.opts.onStateChange?.("connecting");
			try {
				const token = await this.opts.getAccessToken();
				if (token === undefined) throw new Error("未登录");
				const query = new URLSearchParams({
					access_token: token,
					since: String(this.since),
					...(this.opts.conversationId !== undefined ? { conversationId: this.opts.conversationId } : {}),
				});
				this.abortController = new AbortController();
				const response = await this.fetchImpl(`${this.opts.url}/v1/events?${query.toString()}`, {
					signal: this.abortController.signal,
				});
				if (!response.ok || response.body === null) throw new Error(`SSE 连接失败 ${response.status}`);
				this.opts.onStateChange?.("open");
				backoffIndex = 0;
				await this.consumeStream(response.body);
				// 流正常结束（server 关闭）→ 立即重连
			} catch {
				// 网络断开/未登录：退避后重试
			}
			if (this.stopped) break;
			const delay = BACKOFF_STEPS_MS[Math.min(backoffIndex, BACKOFF_STEPS_MS.length - 1)]!;
			backoffIndex += 1;
			await new Promise<void>((resolve) => {
				const timer = setTimeout(resolve, delay);
				this.nextSchedule = () => {
					clearTimeout(timer);
					resolve();
				};
			});
		}
	}

	/** 逐帧解析 data: 行（跨 chunk 缓冲；`data: [done]` 哨兵退出） */
	private async consumeStream(body: ReadableStream<Uint8Array>): Promise<void> {
		const reader = body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";
		try {
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				let boundary: number;
				while ((boundary = buffer.indexOf("\n\n")) >= 0) {
					const frame = buffer.slice(0, boundary);
					buffer = buffer.slice(boundary + 2);
					for (const line of frame.split("\n")) {
						if (!line.startsWith("data: ")) continue;
						const payload = line.slice(6);
						if (payload === "[done]") return;
						this.dispatch(payload);
					}
				}
			}
		} finally {
			reader.releaseLock();
		}
	}

	private dispatch(payload: string): void {
		let event: ServerStreamEvent;
		try {
			event = JSON.parse(payload) as ServerStreamEvent;
		} catch {
			return; // 非 JSON 帧（未来扩展/异常体）忽略
		}
		if (typeof event.seq === "number") this.since = Math.max(this.since, event.seq);
		this.opts.onEvent(event);
	}
}
