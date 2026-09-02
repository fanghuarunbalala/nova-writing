/**
 * gui 共享常量/类型：main / preload / renderer 三侧共用的设计文件 IPC 契约。
 * 通道命名规范 novel.design.v1.*（对齐 gui/scripts/electron-design-file-smoke.mjs）。
 */

/** 设计文件 IPC 通道（frozen；read/write 两个请求/响应通道） */
export const ELECTRON_DESIGN_IPC_CHANNEL = Object.freeze({
	read: "novel.design.v1.read",
	write: "novel.design.v1.write",
} as const);

/** 设计文件 IPC 通道全集（注册/销毁遍历用） */
export const ELECTRON_DESIGN_IPC_CHANNELS = Object.freeze([
	ELECTRON_DESIGN_IPC_CHANNEL.read,
	ELECTRON_DESIGN_IPC_CHANNEL.write,
]);

/** 设计文件 IPC 业务错误（{ ok:false } 载荷） */
export interface DesignIpcError {
	/** 业务错误码（unauthorized / design_file_not_found / invalid_content） */
	readonly code: string;
	/** 是否可重试 */
	readonly retryable: boolean;
}

/** 设计文件 IPC 响应：成功载荷 */
export interface DesignIpcSuccess<T> {
	readonly ok: true;
	readonly value: T;
}

/** 设计文件 IPC 响应：失败载荷 */
export interface DesignIpcFailure {
	readonly ok: false;
	readonly error: DesignIpcError;
}

/** 设计文件 IPC 响应（判别联合） */
export type DesignIpcResult<T> = DesignIpcSuccess<T> | DesignIpcFailure;

/** read 响应 */
export type DesignReadResult = DesignIpcResult<{ content: string }>;
/** write 响应 */
export type DesignWriteResult = DesignIpcResult<{ acknowledged: true }>;
