/**
 * FocusChannel：同项目双开的焦点回切通道（zeromq REQ/REP 一问一答）。
 * 挑战实例 REQ connect 发 focus 请求限时等 ack；持有实例 REP bind 常驻监听，
 * 收到请求触发窗口置前回调并回 ack。用 REQ/REP 而非 Pair：Pair 严格 1:1，
 * 挑战方断开后持有方不再接受新连接，无法支撑多次/多挑战方请求。
 * 地址由 workspaceFocusAddr(workspaceId) 派生，两实例对同一项目天然一致。
 */

import { Reply, Request } from "zeromq";

/** 持有侧句柄（close 即拆除通道；幂等） */
export interface FocusChannelHandle {
	close(): Promise<void>
}

/** focus 请求/应答帧（JSON） */
interface FocusFrame {
	type: "focus" | "focused"
}

/** 帧 → FocusFrame（非法/坏帧返回 undefined） */
function decodeFrame(frame: unknown): FocusFrame | undefined {
	const text = Buffer.isBuffer(frame) ? frame.toString() : String(frame);
	try {
		const parsed = JSON.parse(text) as Partial<FocusFrame>;
		return parsed.type === "focus" || parsed.type === "focused" ? { type: parsed.type } : undefined;
	} catch {
		return undefined;
	}
}

/**
 * 持有侧：bind 地址并循环监听 focus 请求（每条触发一次 onFocus，回 ack）
 * @param address workspaceFocusAddr 派生地址
 * @param onFocus 收到请求时执行（GUI：主窗口 restore+show+focus）
 */
export async function bindFocusChannel(address: string, onFocus: () => void): Promise<FocusChannelHandle> {
	const socket = new Reply();
	await socket.bind(address);
	// 接收泵：close 后 receive 拒绝 → 安静退出（onFocus 抛错只影响本条 ack，泵不停）
	void (async () => {
		for (;;) {
			let frame: unknown;
			try {
				[frame] = await socket.receive();
			} catch {
				return;
			}
			if (decodeFrame(frame)?.type !== "focus") {
				// REP 须回帧才能收下一条；坏帧回 noop 应答保持循环
				await socket.send(Buffer.from(JSON.stringify({ type: "noop" }))).catch(() => {});
				continue;
			}
			try {
				onFocus();
			} catch {
				continue;
			}
			await socket.send(Buffer.from(JSON.stringify({ type: "focused" }))).catch(() => {
				// 对端已关等场景忽略
			});
		}
	})();
	let closed = false;
	return {
		close: async () => {
			if (closed) return;
			closed = true;
			try {
				await socket.close();
			} catch {
				// 关闭失败忽略（进程退出路径 zeromq 自行回收）
			}
		},
	};
}

/**
 * 挑战侧：connect 地址发送 focus 请求并限时等 ack（一次性 socket，用完即弃）
 * @param address workspaceFocusAddr 派生地址
 * @param timeoutMs ack 等待上限（超时视为持有方不可达）
 * @returns true = 持有方已应答（其窗口已被要求置前）
 */
export async function requestFocus(address: string, timeoutMs: number): Promise<boolean> {
	const socket = new Request();
	try {
		await socket.connect(address);
		await socket.send(Buffer.from(JSON.stringify({ type: "focus" } as FocusFrame)));
		// 超时被放弃后，close 会令 receive 拒绝——预挂 catch 防 unhandledRejection
		const received = socket.receive().then(([frame]) => decodeFrame(frame));
		received.catch(() => {});
		const timer = new Promise<never>((_, reject) => {
			setTimeout(() => reject(new Error("focus ack timeout")), timeoutMs).unref();
		});
		const frame = await Promise.race([received, timer]).catch(() => undefined);
		return frame?.type === "focused";
	} catch {
		return false;
	} finally {
		try {
			await socket.close();
		} catch {
			// 同上忽略
		}
	}
}
