/**
 * renderer 侧设计文件端口：unwrap IPC 响应（{ ok:true } → value；{ ok:false } → ApiTransportError）。
 * 注入的 design transport 为「响应信封」函数（IPC invoke 或测试替身）。
 */
import { ApiTransportError } from "@novel/core";
import type { DesignReadResult, DesignWriteResult } from "../../shared/index.js";
import type { DesignFilePort } from "@novel/ui";

/** 设计文件传输面（响应信封函数；renderer 经 preload novelDesign 注入） */
export interface ElectronDesignTransport {
	/**
	 * 读设计文件（响应信封）
	 * @param conversationId 会话 id
	 */
	read(conversationId: string): Promise<DesignReadResult>;
	/**
	 * 写设计文件（响应信封）
	 * @param conversationId 会话 id
	 * @param content 文件内容
	 */
	write(conversationId: string, content: string): Promise<DesignWriteResult>;
}

/**
 * 创建 Electron 设计文件端口：信封 unwrap → DesignFilePort（失败抛 ApiTransportError）
 * @param opts design 传输面（IPC invoke / 测试替身）
 * @returns DesignFilePort（read/write 解包后的语义面）
 */
export function createElectronDesignFilePort(opts: { design: ElectronDesignTransport }): DesignFilePort {
	return Object.freeze({
		/**
		 * 读取会话 design 文件内容
		 * @param conversationId 会话 id
		 * @returns 文件内容（失败抛 ApiTransportError）
		 */
		read: async (conversationId: string): Promise<string> => {
			const result = await opts.design.read(conversationId);
			if (!result.ok) {
				throw new ApiTransportError(result.error.code, result.error.retryable);
			}
			return result.value.content;
		},
		/**
		 * 写入（创建/覆盖）会话 design 文件
		 * @param conversationId 会话 id
		 * @param content 文件内容
		 */
		write: async (conversationId: string, content: string): Promise<void> => {
			const result = await opts.design.write(conversationId, content);
			if (!result.ok) {
				throw new ApiTransportError(result.error.code, result.error.retryable);
			}
		},
	});
}
