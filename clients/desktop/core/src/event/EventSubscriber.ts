/**
 * EventSubscriber：ZeroMQ SUB 消费者（connect + topic 前缀过滤 + for-await 拉取）。
 * 注意 slow joiner：SUB 连接/订阅完成前 PUB 发的消息会错过（消费者需重查兜底）。
 */

import { Subscriber } from "zeromq";

/** 收到的解码事件 */
export interface ReceivedEvent<T = unknown> {
	/** topic（前缀过滤命中） */
	topic: string
	/** JSON 解码后的负载 */
	payload: T
}

/** ZeroMQ SUB 事件消费者 */
export class EventSubscriber {
	private readonly socket: Subscriber;
	private readonly topics: readonly string[];

	/**
	 * @param address 连接的 ZeroMQ 地址
	 * @param topics topic 前缀过滤（subscribe(prefix)，只收匹配前缀）
	 */
	constructor(
		private readonly address: string,
		topics: readonly string[],
	) {
		this.socket = new Subscriber();
		this.topics = topics;
	}

	/** 连接地址并在连接后订阅（subscribe 必须在 connect 之后才可靠传播） */
	async connect(): Promise<void> {
		await this.socket.connect(this.address);
		for (const topic of this.topics) this.socket.subscribe(topic);
	}

	/** 异步迭代器：拉取 { topic, payload }，break/return 即停止 */
	async *[Symbol.asyncIterator](): AsyncIterator<ReceivedEvent> {
		for await (const [topic, payload] of this.socket) {
			yield {
				topic: Buffer.isBuffer(topic) ? topic.toString() : String(topic),
				payload: decodePayload(payload),
			};
		}
	}

	/** 关闭并断开 */
	async close(): Promise<void> {
		await this.socket.close();
	}
}

/** payload 帧 → 对象（JSON 解码，失败原样字符串） */
function decodePayload(frame: unknown): unknown {
	const text = Buffer.isBuffer(frame) ? frame.toString() : String(frame);
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return text;
	}
}
