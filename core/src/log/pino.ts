/**
 * pino 后端实现：每个进程独占自己的日志文件（单写者），文件写可读文本行 + stderr pretty 双流。
 * 关键：绝不写 stdout——它是 stdio 进程（conversation / manager）的协议通道。
 * 文件行格式：`[YYYY-MM-DD HH:MM:SS.mmm] LEVEL  event  key=value  key=value`（无 JSON 花括号）。
 */

import { join } from "node:path";
import pino, { type DestinationStream, type Logger as PinoLogger } from "pino";
import roll from "pino-roll";
import type { LogFields, LogLevel, Logger } from "./Logger.js";

/** pino level 数值 → 文本标签 */
const LEVEL_LABEL: Readonly<Record<number, string>> = Object.freeze({
	10: "TRACE",
	20: "DEBUG",
	30: "INFO",
	40: "WARN",
	50: "ERROR",
	60: "FATAL",
});

/** SonicBoom（pino-roll 文件流）的 flush 能力：异步 flush 会等待文件就绪，flushSync 未就绪会抛 */
interface Flushable {
	flush?(): Promise<void> | void
	flushSync?(): void
	write(chunk: string): void
}

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
 * 文件命名：`<name>-<id>-<pid>.log`（conversation = `conversation-<conversationId>-<pid>.log`），
 * pid 保证每次运行独占，重启写新文件不覆盖。
 * 单一 destination：格式化写文件（可读文本行）+ 转发 pino-pretty 到 stderr；不碰 stdout。
 * @param opts 创建选项
 * @returns 平台无关 Logger
 */
export async function createLogger(opts: CreateLoggerOptions): Promise<Logger> {
	const level = (opts.level ?? process.env.NOVEL_LOG_LEVEL ?? "info") as LogLevel
	const base = `${opts.name}${opts.id ? `-${opts.id}` : ""}-${process.pid}`
	const fileStream = (await roll({
		file: join(opts.logDir, `${base}.log`),
		size: "10M",
		limit: { count: 5 },
		mkdir: true,
	})) as unknown as Flushable
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

	// 单一 destination：pino 每行 JSON → 格式化写文件 + 转发 pretty（stderr）
	// DestinationStream 类型无 flush 属性，但 pino.flush() 运行时按可选调用，故断言
	const dest = {
		write(msg: string) {
			const text = formatLine(msg)
			if (text) fileStream.write(text + "\n")
			prettyStream.write(msg)
		},
		flush() {
			;(prettyStream as Flushable).flush?.()
		},
	} as unknown as DestinationStream

	const root = pino(
		{
			level,
			messageKey: "event",
			// 去掉 pid/hostname 冗余（文件命名已含 pid）
			base: undefined,
		},
		dest,
	)
	const bound = opts.bindings ? root.child(opts.bindings as pino.Bindings) : root
	const adapted = adaptPinoLogger(bound)
	return {
		...adapted,
		// 覆盖 flush：pino 内部 + 文件落盘（异步等待 SonicBoom 就绪）
		flush: async () => {
			root.flush()
			await flushFile(fileStream)
		},
	}
}

/** 文件流落盘：优先异步 flush（等待就绪），否则 flushSync */
async function flushFile(stream: Flushable): Promise<void> {
	if (stream.flush) {
		await stream.flush()
	} else {
		stream.flushSync?.()
	}
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

/** pino JSON 行 → 可读文本行；解析失败原样保留 */
function formatLine(raw: string): string {
	const line = raw.trim()
	if (!line) return ""
	let rec: Record<string, unknown>
	try {
		rec = JSON.parse(line)
	} catch {
		return line
	}
	const level = LEVEL_LABEL[rec.level as number] ?? String(rec.level ?? "")
	const event = typeof rec.event === "string" ? rec.event : ""
	const ts = typeof rec.time === "number" ? formatTs(new Date(rec.time)) : ""
	const fields: string[] = []
	for (const [k, v] of Object.entries(rec)) {
		if (k === "level" || k === "time" || k === "event") continue
		fields.push(`${k}=${formatValue(v)}`)
	}
	return `[${ts}] ${level.padEnd(5)} ${event}${fields.length ? `  ${fields.join("  ")}` : ""}`
}

/** Date → `YYYY-MM-DD HH:MM:SS.mmm` */
function formatTs(d: Date): string {
	const p = (n: number, w = 2) => String(n).padStart(w, "0")
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
}

/** 字段值渲染：字符串不带引号，对象/数组 JSON */
function formatValue(v: unknown): string {
	if (v === null) return "null"
	if (v === undefined) return "undefined"
	if (typeof v === "string") return v
	if (typeof v === "object") return JSON.stringify(v)
	return String(v)
}
