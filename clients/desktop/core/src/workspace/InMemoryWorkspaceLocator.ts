/**
 * InMemoryWorkspaceLocator：内存版 WorkspaceLocator（测试）。
 */

import type { WorkspaceLocation } from "./contract.js";
import type { WorkspaceLocator } from "./locator.js";

/** 内存版定位器（resolve 用 root 派生 id + storeDir 为 root/.novel） */
export class InMemoryWorkspaceLocator implements WorkspaceLocator {
	private readonly locations = new Map<string, WorkspaceLocation>();

	/** 由 root 派生定位（id 用 root 本身，storeDir = root/.novel） */
	async resolve(workspaceRoot: string): Promise<WorkspaceLocation> {
		const location: WorkspaceLocation = {
			workspaceId: workspaceRoot,
			workspaceRoot,
			storeDir: `${workspaceRoot}/.novel`,
		};
		this.locations.set(location.workspaceId, location);
		return location;
	}

	/** 按 id 反查 */
	async getByWorkspaceId(workspaceId: string): Promise<WorkspaceLocation | undefined> {
		return this.locations.get(workspaceId);
	}
}
