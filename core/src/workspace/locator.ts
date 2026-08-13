/**
 * WorkspaceLocator：workspace 目录定位抽象。
 */

import type { WorkspaceLocation } from "./contract.js";

/** workspace 定位器（resolve 派生 / getByWorkspaceId 反查） */
export interface WorkspaceLocator {
	/**
	 * 由项目根目录派生 workspace 定位
	 * @param workspaceRoot 项目根目录绝对路径
	 * @returns 定位结果
	 */
	resolve(workspaceRoot: string): Promise<WorkspaceLocation>
	/**
	 * 按 id 反查定位
	 * @param workspaceId workspace id
	 * @returns 定位结果（未知 id 返回 undefined）
	 */
	getByWorkspaceId(workspaceId: string): Promise<WorkspaceLocation | undefined>
}
