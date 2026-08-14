/**
 * consoleLogger：console 实现的 Logger（无 pino 落盘环境的轻量选择，如 gui main）。
 * 输出 JSON 单行（与 pino 行格式对齐，便于 grep/采集统一）；child 追加 component 字段。
 */

import type { LogFields, Logger, LogLevel } from "./Logger.js";

const LEVEL_ORDER: Record<LogLevel, number> = {
	trace: 10,
	debug: 20,
	info: 30,
	warn: 40,
	error: 50,
};

/** 输出方法名（调用时动态取 console[method]，保证测试 spy 可替换） */
const LEVEL_METHOD: Record<LogLevel, "log" | "warn" | "error"> = {
	trace: "log",
	debug: "log",
	info: "log",
	warn: "warn",
	error: "error",
};

/** 创建 console Logger
 * @param base 常驻字段（child 链路累积）
 * @param minLevel 最低输出级别（缺省 info；trace/debug 需显式开启）
 */
function create(base: LogFields, minLevel: LogLevel): Logger {
	const emit = (level: LogLevel, event: string, fields?: LogFields): void => {
		if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;
		console[LEVEL_METHOD[level]](
			JSON.stringify({ level, time: new Date().toISOString(), event, ...base, ...fields }),
		);
	};
	return {
		trace: (event, fields) => emit("trace", event, fields),
		debug: (event, fields) => emit("debug", event, fields),
		info: (event, fields) => emit("info", event, fields),
		warn: (event, fields) => emit("warn", event, fields),
		error: (event, fields) => emit("error", event, fields),
		child: (fields) => create({ ...base, ...fields }, minLevel),
		flush: async () => {},
		close: async () => {},
	};
}

/** console Logger 工厂（info 级起步；verbose 场景经 NOVEL_LOG_LEVEL=verbose 升 debug） */
export function createConsoleLogger(minLevel: LogLevel = resolveLevelFromEnv()): Logger {
	return create({}, minLevel);
}

function resolveLevelFromEnv(): LogLevel {
	const level = process.env.NOVEL_LOG_LEVEL;
	return level === "verbose" ? "debug" : "info";
}
