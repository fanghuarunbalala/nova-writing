/**
 * pino 后端实现：每个进程独占自己的日志文件（单写者），stderr pretty + 文件 JSON 双流。
 * 关键：绝不写 stdout——它是 stdio 进程（conversation / manager）的协议通道。
 */

import { join } from "node:path";
import pino, { type Logger as PinoLogger } from "pino";
import roll from "pino-roll";
import type { LogFields, LogLevel, Logger } from "./Logger.js";

/** 创建进程独占 logger 的选项 */
export interface CreateLoggerOptions {
	/** 进程名（zygote / manager / novel-db / conversation） */
	name: string
	/** 身份 id（conversationId；文件命名用，非会话进程缺省） */
	id?: string
	/** 日志目录（每进程一个文件，自动创建） */
	logDir: string
	/** 级别；缺省从 env NOVEL_LOG_LEVEL 读，再缺省 "info" */
	level?: LogLevel
	/** 常驻绑定字段（如 { conversationId, agentId }） */
	bindings?: LogFields
}

/**
 * 创建进程独占的 pino logger。
 * 文件命名：`<name>-<id>-<pid>.log`（conversation 进程 = `conversation-<conversationId>-<pid>.log`），
 * pid 保证每次运行独占，重启写新文件不覆盖。
 * stderr：pino-pretty 单行人读；文件：原始 JSON 机器聚合。二者都不碰 stdout。
 * @param opts 创建选项
 * @returns 平台无关 Logger
 */
export async function createLogger(opts: CreateLoggerOptions): Promise<Logger> {
	const level = (opts.level ?? process.env.NOVEL_LOG_LEVEL ?? "info") as LogLevel
	const base = `${opts.name}${opts.id ? `-${opts.id}` : ""}-${process.pid}`
	const fileStream = await roll({
		file: join(opts.logDir, `${base}.log`),
		size: "10M",
		limit: { count: 5 },
		mkdir: true,
	})
	const prettyStream = pino.transport({
		target: "pino-pretty",
		options: {
			// destination: 2 → stderr（默认 stdout，会污染协议通道）
			destination: 2,
			singleLine: true,
			colorize: true,
			translateTime: "SYS:HH:MM:ss.l",
			messageKey: "event",
		},
	})
	const multi = pino.multistream([{ stream: prettyStream }, { stream: fileStream }])
	const root = pino(
		{
			level,
			messageKey: "event",
			// 去掉 pid/hostname 冗余（文件命名已含 pid）
			base: undefined,
		},
		multi,
	)
	const bound = opts.bindings ? root.child(opts.bindings as pino.Bindings) : root
	return adaptPinoLogger(bound)
}

/** 把 pino 实例包装成自定义 Logger 接口；child 保留 pino 绑定继承 */
function adaptPinoLogger(base: PinoLogger): Logger {
	// pino 的 level 方法依赖 this 指向 logger 实例，必须先 bind
	const trace = base.trace.bind(base)
	const debug = base.debug.bind(base)
	const info = base.info.bind(base)
	const warn = base.warn.bind(base)
	const error = base.error.bind(base)
	return {
		trace: (event, fields) => write(trace, event, fields),
		debug: (event, fields) => write(debug, event, fields),
		info: (event, fields) => write(info, event, fields),
		warn: (event, fields) => write(warn, event, fields),
		error: (event, fields) => write(error, event, fields),
		child: (bindings) => adaptPinoLogger(base.child(bindings as pino.Bindings)),
		flush: async () => {
			base.flush()
		},
	}
}

/** 写一条记录：fields 并入 + event 名作为主键 */
function write(
	method: (obj: object, msg?: string, ...args: unknown[]) => void,
	event: string,
	fields: LogFields | undefined,
): void {
	method({ ...(fields ?? {}) }, event)
}
