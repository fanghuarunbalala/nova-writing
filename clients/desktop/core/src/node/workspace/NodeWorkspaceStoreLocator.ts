/**
 * NodeWorkspaceStoreLocator：node 版 WorkspaceLocator（storageRoot 派生 storeDir）。
 */

import { createHash } from "node:crypto";
import { join, normalize } from "node:path";
import type { WorkspaceLocation } from "../../workspace/contract.js";
import type { WorkspaceLocator } from "../../workspace/locator.js";

/** node 定位器构造选项 */
export interface NodeWorkspaceStoreLocatorOptions {
	/** 存储根目录（storageRoot/<父目录>-<项目名>--<hash8> 派生 storeDir） */
	storageRoot: string
}

/** 目录段清洗：Windows 非法字符（<>:"/\|?* + 控制字符）→ "-"；去尾部空白/点；限长防超路径预算 */
function toDirSegment(name: string): string {
	return name
		.replace(/[<>:"/\\|?*\x00-\x1f]/g, "-")
		.replace(/[\s.]+$/, "")
		.slice(0, 50);
}

/** node 版定位器：id 由 root 哈希派生（注册表键），storeDir 名可读 = <父目录>-<项目名>--<hash8> */
export class NodeWorkspaceStoreLocator implements WorkspaceLocator {
	private readonly storageRoot: string;

	/**
	 * @param options storageRoot
	 */
	constructor(options: NodeWorkspaceStoreLocatorOptions) {
		this.storageRoot = options.storageRoot;
	}

	/**
	 * 由 root 派生定位
	 * @param workspaceRoot 项目根目录绝对路径
	 * @returns 定位结果
	 */
	async resolve(workspaceRoot: string): Promise<WorkspaceLocation> {
		const hash = createHash("sha1").update(workspaceRoot).digest("hex");
		const workspaceId = hash.slice(0, 12);
		// 目录名可读化：<父目录小写>-<项目名>--<hash8>（hash8 = sha1 前 8 位，
		// 同名项目 / 路径大小写变体靠它区分；父目录小写对齐历史方案样式）。
		// 分隔符跨平台归一（\ 与 / 均切分）：宿主 basename/dirname 随平台走，
		// Windows 风格路径在 Linux/macOS 宿主下须派生一致目录名（CI 即此场景）
		const segments = normalize(workspaceRoot)
			.replaceAll("\\", "/")
			.split("/")
			.filter((segment) => segment !== "");
		const leaf = toDirSegment(segments.at(-1) ?? "");
		const parent = toDirSegment(segments.at(-2) ?? "").toLowerCase();
		const dirName = `${parent ? `${parent}-` : ""}${leaf || "workspace"}--${hash.slice(0, 8)}`;
		return {
			workspaceId,
			workspaceRoot,
			storeDir: join(this.storageRoot, dirName),
		};
	}

	/**
	 * 按 id 反查（id→root 映射由上层（recent store）持久化，此处不反推）
	 * @param _workspaceId workspace id
	 * @returns undefined
	 */
	async getByWorkspaceId(_workspaceId: string): Promise<WorkspaceLocation | undefined> {
		return undefined;
	}
}
