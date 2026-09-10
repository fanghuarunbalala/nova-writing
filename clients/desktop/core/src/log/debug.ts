/**
 * 轻量调试日志工具（browser-safe，不进文件，只打 stderr/console）。
 * 级别模型：release = info（默认，仅 infoLog 输出）；debug = verbose
 * （经 env NOVEL_LOG_LEVEL=verbose 开启，debugLog 也输出）。
 * renderer 侧经 preload 注入 window.__NOVEL_LOG_LEVEL__（浏览器无 process.env）。
 * 进程结构化的正式日志走 pino（createLogger），本工具用于链路诊断与临时排查日志。
 */

declare global {
	interface Window {
		/** preload 注入的日志级别（renderer 侧 debugLog 开关） */
		__NOVEL_LOG_LEVEL__?: string;
	}
}

/** 读取全局日志级别（Node 经 env；浏览器经 preload 注入） */
function resolveLevel(): string {
	const g = globalThis as {
		process?: { env?: { NOVEL_LOG_LEVEL?: string } };
		window?: Window;
	};
	return g.process?.env?.NOVEL_LOG_LEVEL ?? g.window?.__NOVEL_LOG_LEVEL__ ?? "info";
}

/** 是否 debug（verbose）模式 */
export function isVerboseLog(): boolean {
	return resolveLevel() === "verbose";
}

/**
 * 调试日志：仅 NOVEL_LOG_LEVEL=verbose 时输出（stderr/console）。
 * 用于链路诊断与排查日志——保留在代码中，release 构建静默。
 * @param args 任意日志参数
 */
export function debugLog(...args: unknown[]): void {
	if (!isVerboseLog()) return;
	console.error(...args);
}

/**
 * info 级日志：默认（release）级别即输出。
 * 用于关键状态行（进程就绪、provider 解析、连接建立等）。
 * @param args 任意日志参数
 */
export function infoLog(...args: unknown[]): void {
	console.error(...args);
}
