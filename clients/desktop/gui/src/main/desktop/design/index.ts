/**
 * 桌面设计文件服务 + IPC 控制器（compose 设计草稿读写）。
 * 落盘布局：<workspaceRoot>/.novel/design/<conversationId>.md（id 非法字符替换 -，
 * 与 core ComposeModeService.designFilePathFor 一致）。
 * 规格：gui/scripts/electron-design-file-smoke.mjs（未授权 unauthorized /
 * 文件缺失 design_file_not_found / dispose 移除 handler）。
 */
import { promises as fs } from "node:fs";
import { join } from "node:path";
import {
	ELECTRON_DESIGN_IPC_CHANNEL,
	ELECTRON_DESIGN_IPC_CHANNELS,
	type DesignReadResult,
	type DesignWriteResult,
} from "../../../shared/index.js";

/** ipcMain 最小结构面（real electron ipcMain 结构化兼容） */
export interface DesignIpcMain {
	/**
	 * 注册请求/响应 handler
	 * @param channel 通道名
	 * @param handler 处理器（event + 参数）
	 */
	handle(
		channel: string,
		handler: (event: unknown, ...args: string[]) => Promise<unknown>,
	): void;
	/**
	 * 移除 handler
	 * @param channel 通道名
	 */
	removeHandler(channel: string): void;
}

/** 未授权响应（channel 无关共用） */
function unauthorized(): { ok: false; error: { code: "unauthorized"; retryable: false } } {
	return Object.freeze({ ok: false, error: Object.freeze({ code: "unauthorized", retryable: false }) });
}

/** design 文件绝对路径（id 非法字符替换 -，防路径注入） */
function designFilePath(workspaceRoot: string, conversationId: string): string {
	const safe = conversationId.replace(/[^A-Za-z0-9._-]/g, "-");
	return join(workspaceRoot, ".novel", "design", `${safe}.md`);
}

/** 桌面设计文件服务：按 sender 解析 workspace 根 + 读写 design 文件 */
export class DesktopDesignFileService {
	/** workspace 根解析器（senderId → 根目录；未授权返回 undefined） */
	private readonly resolveWorkspaceRoot: (senderId: number) => string | undefined;

	/**
	 * @param opts resolveWorkspaceRoot（senderId → workspace 根；未授权 undefined）
	 */
	constructor(opts: { resolveWorkspaceRoot: (senderId: number) => string | undefined }) {
		this.resolveWorkspaceRoot = opts.resolveWorkspaceRoot;
	}

	/**
	 * 读取会话 design 文件内容
	 * @param senderId 请求方 webContents id（workspace 解析用）
	 * @param conversationId 会话 id
	 * @returns 成功含 content；未授权/文件缺失失败载荷
	 */
	async read(senderId: number, conversationId: string): Promise<DesignReadResult> {
		const root = this.resolveWorkspaceRoot(senderId);
		if (root === undefined) return unauthorized();
		try {
			const content = await fs.readFile(designFilePath(root, conversationId), "utf8");
			return Object.freeze({ ok: true, value: Object.freeze({ content }) });
		} catch {
			return Object.freeze({
				ok: false,
				error: Object.freeze({ code: "design_file_not_found", retryable: false }),
			});
		}
	}

	/**
	 * 写入（创建/覆盖）会话 design 文件
	 * @param senderId 请求方 webContents id（workspace 解析用）
	 * @param conversationId 会话 id
	 * @param content 文件内容
	 * @returns 成功 acknowledged；未授权/内容非法失败载荷
	 */
	async write(
		senderId: number,
		conversationId: string,
		content: string,
	): Promise<DesignWriteResult> {
		const root = this.resolveWorkspaceRoot(senderId);
		if (root === undefined) return unauthorized();
		if (typeof content !== "string") {
			return Object.freeze({
				ok: false,
				error: Object.freeze({ code: "invalid_content", retryable: false }),
			});
		}
		const file = designFilePath(root, conversationId);
		await fs.mkdir(join(root, ".novel", "design"), { recursive: true });
		await fs.writeFile(file, content, "utf8");
		return Object.freeze({ ok: true, value: Object.freeze({ acknowledged: true }) });
	}
}

/** 桌面设计文件 IPC 控制器：register 绑定 read/write 通道 + dispose 移除 */
export class DesktopDesignIpcController {
	/** 设计文件服务 */
	private readonly service: DesktopDesignFileService;
	/** sender 授权判定 */
	private readonly authorizeSender: (senderId: number) => boolean;
	/** register 时保存的 ipcMain（dispose 移除 handler 用） */
	private ipcMainRef?: DesignIpcMain;

	/**
	 * @param opts service + authorizeSender（senderId → 是否授权）
	 */
	constructor(opts: {
		service: DesktopDesignFileService;
		authorizeSender: (senderId: number) => boolean;
	}) {
		this.service = opts.service;
		this.authorizeSender = opts.authorizeSender;
	}

	/**
	 * 注册 read/write handler（重复注册由 ipcMain 自身报错）
	 * @param ipcMain Electron ipcMain（或测试替身）
	 */
	register(ipcMain: DesignIpcMain): void {
		this.ipcMainRef = ipcMain;
		ipcMain.handle(ELECTRON_DESIGN_IPC_CHANNEL.read, async (event, conversationId) => {
			const senderId = senderIdOf(event);
			if (senderId === undefined || !this.authorizeSender(senderId)) return unauthorized();
			return this.service.read(senderId, conversationId);
		});
		ipcMain.handle(ELECTRON_DESIGN_IPC_CHANNEL.write, async (event, conversationId, content) => {
			const senderId = senderIdOf(event);
			if (senderId === undefined || !this.authorizeSender(senderId)) return unauthorized();
			return this.service.write(senderId, conversationId, content);
		});
	}

	/** 移除全部 handler（窗口关闭/应用退出时调用） */
	async dispose(): Promise<void> {
		for (const channel of ELECTRON_DESIGN_IPC_CHANNELS) {
			this.ipcMainRef?.removeHandler(channel);
		}
		this.ipcMainRef = undefined;
	}
}

/** 从 IPC event 取 sender id（electron IpcMainInvokeEvent 结构） */
function senderIdOf(event: unknown): number | undefined {
	if (event === null || typeof event !== "object") return undefined;
	const sender = (event as { sender?: unknown }).sender;
	if (sender === null || typeof sender !== "object") return undefined;
	const id = (sender as { id?: unknown }).id;
	return typeof id === "number" ? id : undefined;
}
