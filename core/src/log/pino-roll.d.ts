/**
 * pino-roll 类型声明（包本身无类型，最小化声明覆盖本项目用到的选项）。
 */

declare module "pino-roll" {
	/** 轮转选项 */
	export interface RollOptions {
		/** 日志文件路径（轮转时附加序号） */
		file: string
		/** 单文件最大大小（如 "10M"） */
		size?: string | number
		/** 轮转频率（如 "daily"） */
		frequency?: string
		/** 保留的滚动文件数 */
		limit?: { count: number; removeOtherLogFiles?: boolean }
		/** 自动创建父目录 */
		mkdir?: boolean
	}

	/** 创建轮转文件流（SonicBoom，兼容 pino 目的地）；pino-roll 为 CJS 默认导出 */
	export default function roll(
		options: RollOptions,
	): Promise<import("node:stream").Writable>
}
