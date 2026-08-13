/**
 * NodeWorkspaceStoreLocator：node 版 WorkspaceLocator（storageRoot 派生 storeDir）。
 */

import { createHash } from "node:crypto";
import { join } from "node:path";
import type { WorkspaceLocation } from "../../workspace/contract.js";
import type { WorkspaceLocator } from "../../workspace/locator.js";

/** node 定位器构造选项 */
export interface NodeWorkspaceStoreLocatorOptions {
	/** 存储根目录（storageRoot/<workspaceId> 派生 storeDir） */
	storageRoot: string
}

/** node 版定位器：id 由 root 哈希派生，storeDir = storageRoot/<id> */
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
		const workspaceId = createHash("sha1").update(workspaceRoot).digest("hex").slice(0, 12);
		return {
			workspaceId,
			workspaceRoot,
			storeDir: join(this.storageRoot, workspaceId),
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
