/**
 * noopLogger：空实现 Logger（UI 缺省日志 / 测试）。
 * 纯 JS 无 pino 依赖，可安全进 browser bundle（经 @novel/core/client 导出）。
 */

import type { Logger, LogFields } from "./Logger.js";

const noop = (_event: string, _fields?: LogFields): void => {};
const noopAsync = async (): Promise<void> => {};

/** 空实现 Logger（所有方法 no-op，child 返回自身） */
export const noopLogger: Logger = {
	trace: noop,
	debug: noop,
	info: noop,
	warn: noop,
	error: noop,
	child: () => noopLogger,
	flush: noopAsync,
	close: noopAsync,
};
