/**
 * EventPublisher：ZeroMQ PUB 事件源（bind 后 publish）。
 * 帧 = [topic, JSON(payload)]；无 SUB 连接时消息丢弃（fire-and-forget）。
 */

import { Publisher } from "zeromq";

/** ZeroMQ PUB 事件源 */
export class EventPublisher {
	private readonly socket: Publisher;

	/**
	 * @param address 绑定的 ZeroMQ 地址（ipc:// 命名管道 / tcp:// / inproc:// 测试）
	 */
	constructor(private readonly address: string) {
		this.socket = new Publisher();
	}

	/** 绑定地址（一个地址一个 PUB） */
	async bind(): Promise<void> {
		await this.socket.bind(this.address);
	}

	/**
	 * 发布事件（fire-and-forget：无订阅者即丢弃；send 异步，失败忽略）
	 * @param topic topic 前缀（SUB 按前缀过滤）
	 * @param payload 事件负载（JSON 编码）
	 */
	publish(topic: string, payload: unknown): void {
		this.socket
			.send([Buffer.from(topic), Buffer.from(JSON.stringify(payload))])
			.catch(() => {
				// fire-and-forget：socket 关闭等场景忽略
			});
	}

	/** 关闭并断开 */
	async close(): Promise<void> {
		await this.socket.close();
	}
}
