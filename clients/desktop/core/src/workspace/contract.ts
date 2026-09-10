/**
 * workspace 域契约：目录定位（workspace 根 → id + storeDir）。
 */

/** workspace 定位结果 */
export interface WorkspaceLocation {
	/** workspace id（由 root 派生，稳定） */
	workspaceId: string
	/** 用户选择的项目根目录 */
	workspaceRoot: string
	/** 存储目录（sqlite + journal 落盘处） */
	storeDir: string
}
