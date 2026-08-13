/**
 * NodeConfigHomeResolver：解析 config 主目录（Electron main 注入 userData）。
 */

import { homedir } from "node:os";
import { join } from "node:path";

/** node config 主目录解析器 */
export class NodeConfigHomeResolver {
	private readonly homeDir?: string;

	/**
	 * @param homeDir config 主目录（缺省 ~/.novel）
	 */
	constructor(homeDir?: string) {
		this.homeDir = homeDir;
	}

	/**
	 * 解析 config 主目录
	 * @returns 绝对路径
	 */
	resolve(): string {
		return this.homeDir ?? join(homedir(), ".novel");
	}
}
