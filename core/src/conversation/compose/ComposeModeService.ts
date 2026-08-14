/**
 * Compose 工具服务：进入/退出 compose + 会话 mode（review/bypass/compose）迁移的统一服务。
 * 对齐 legacy ComposeToolService 语义，去掉 DB 端口：写序 = ①内存状态 → ②事件 sink
 * （sink 由 Conversation 装配：先 state.jsonl 落盘再 hub 广播，见 T8）。
 * 状态权威是 ComposeModeStateProvider（会话进程自持）；事件只是状态迁移的广播。
 */
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { Logger } from "../../log/Logger.js";
import { noopLogger } from "../../log/noop.js";
import type { OutputEvent, PersistedOutputEvent } from "../contract/events/index.js";
import {
	DEFAULT_CONVERSATION_MODE,
	type ComposeModePhase,
	type ConversationMode,
} from "../contract/types/index.js";
import { ComposeModeStateProvider, type ComposeModeSnapshot } from "./ComposeModeState.js";

/** 事件出口：状态迁移事件（compose.* 与 mode.* 家族）；sink 由 Conversation 装配（先落盘后广播） */
export type ComposeEventSink = (event: OutputEvent) => void;

/** 分布式 Omit：对 union 逐成员剔除 K（保留判别联合，避免塌缩成公共键） */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** 缺 ts 的事件（#emit 统一补时间戳） */
type EmitEvent = DistributiveOmit<OutputEvent, "ts">;

/** 批准后写入审计记录（可选） */
export interface ComposeCommitRecord {
	/** design id（design 文件名去扩展名） */
	readonly designId: string;
	/** 会话 id */
	readonly conversationId: string;
	/** 批准时间 */
	readonly approvedAt: string;
	/** 草稿内容 sha256 */
	readonly contentDigest: string;
	/** 归档路径 */
	readonly archivePath: string;
}

/** 审计记录器（可选装配） */
export interface ComposeCommitRecorder {
	/**
	 * 记录一次批准的归档
	 * @param record 归档记录
	 */
	record(record: ComposeCommitRecord): Promise<void>;
}

/** 进入 compose 的结果详情 */
export type ComposeEnterDetails = {
	readonly designFilePath: string;
	readonly phase: ComposeModePhase;
	readonly purpose?: string;
	/** 进入前已在 compose（幂等返回当前状态，未重复进入） */
	readonly alreadyActive?: boolean;
};

/** 退出 compose 的结果详情 */
export type ComposeExitDetails = {
	readonly designFilePath: string;
	readonly phase: ComposeModePhase;
	readonly preComposeMode?: ConversationMode;
};

/** ComposeModeService 构造选项 */
export interface ComposeModeServiceOptions {
	/** compose 状态提供者（会话进程自持的权威） */
	readonly composeState: ComposeModeStateProvider;
	/** design 根目录（workspace/.novel/design） */
	readonly designRoot: string;
	/** 事件出口（缺省 no-op，仅内存状态迁移） */
	readonly eventSink?: ComposeEventSink;
	/** 批准后审计记录器（缺省不记录） */
	readonly commitRecorder?: ComposeCommitRecorder;
	/** 会话是否有挂起审批的探测（装配注入；用于挂起审批时延迟 mode 切换） */
	readonly pendingApprovalProbe?: (conversationId: string) => Promise<boolean>;
	/** 结构化日志（缺省不打） */
	readonly logger?: Logger;
}

/** 事件 sink 的空实现 */
const NOOP_EVENT_SINK: ComposeEventSink = () => {};

/**
 * 提供 Enter/ExitComposeMode + mode 迁移的 provider-neutral 服务。
 * begin/exit/discard/setMode 均为异步（fs 与事件 sink 全异步）；状态迁移失败不落事件。
 */
export class ComposeModeService {
	readonly #composeState: ComposeModeStateProvider;
	readonly #designRoot: string;
	readonly #logger: Logger;
	readonly #commitRecorder: ComposeCommitRecorder | undefined;
	#eventSink: ComposeEventSink;
	#pendingApprovalProbe: ((conversationId: string) => Promise<boolean>) | undefined;
	/** 审核（pending）中延迟的 mode 目标：下一次 setMode 晋升 */
	readonly #pendingModeTargets = new Map<string, ConversationMode>();

	/**
	 * @param options 状态提供者 + design 根目录 + 可选 sink/审计/探测/日志
	 */
	constructor(options: ComposeModeServiceOptions) {
		this.#composeState = options.composeState;
		this.#designRoot = path.resolve(options.designRoot);
		this.#eventSink = options.eventSink ?? NOOP_EVENT_SINK;
		this.#commitRecorder = options.commitRecorder;
		this.#pendingApprovalProbe = options.pendingApprovalProbe;
		this.#logger = (options.logger ?? noopLogger).child({ component: "compose_mode_service" });
	}

	/**
	 * 会话 design 文件绝对路径（每会话一份：.novel/design/<sanitized-id>.md）
	 * @param conversationId 会话 id
	 * @returns design 文件绝对路径
	 */
	designFilePathFor(conversationId: string): string {
		const safe = conversationId.replace(/[^A-Za-z0-9._-]/g, "-");
		return path.join(this.#designRoot, `${safe}.md`);
	}

	/**
	 * 进入 compose：建空 design 文件、状态到 designing、发 compose.begin + mode.changed(compose)。
	 * 幂等：已处于 compose 时返回当前状态，不重复进入、不删草稿、不发重复事件。
	 * @param conversationId 会话 id
	 * @param purpose 可选目的（仅记录在结果里）
	 * @returns 进入详情（含 alreadyActive 幂等标记）
	 */
	async begin(conversationId: string, purpose?: string): Promise<ComposeEnterDetails> {
		const existing = this.#composeState.snapshot(conversationId);
		if (existing.active) {
			const designFilePath =
				existing.designFilePath ?? this.designFilePathFor(conversationId);
			this.#logger.debug("compose.begin_idempotent", { conversationId, phase: existing.phase });
			return Object.freeze({
				designFilePath,
				phase: existing.phase,
				...(purpose === undefined ? {} : { purpose }),
				alreadyActive: true,
			});
		}
		const designFilePath = this.designFilePathFor(conversationId);
		await fs.mkdir(this.#designRoot, { recursive: true });
		// 旧草稿探测：design 文件已存在 = 上次会话残留（discard 才删、exit 归档）
		let hasPriorDraft = false;
		try {
			await fs.access(designFilePath);
			hasPriorDraft = true;
		} catch {
			await fs.writeFile(designFilePath, "", "utf8");
		}
		const currentMode = this.#composeState.snapshot(conversationId).mode;
		const snapshot = this.#composeState.enter(conversationId, {
			designFilePath,
			preComposeMode: currentMode,
			hasPriorDraft,
		});
		this.#emit({
			type: "compose.begin",
			persist: true,
			phase: snapshot.phase,
			designFilePath,
			preComposeMode: snapshot.preComposeMode,
			hasPriorDraft: snapshot.hasPriorDraft,
			conversationId,
		});
		this.#emitModeChanged(conversationId, "compose");
		this.#logger.info("compose.begin", { conversationId, phase: snapshot.phase, hasPriorDraft });
		return Object.freeze({
			designFilePath,
			phase: snapshot.phase,
			...(purpose === undefined ? {} : { purpose }),
		});
	}

	/**
	 * 提交审批：designing → pending，发 compose.submitted（携带 approvalRequestId）
	 * @param conversationId 会话 id
	 * @param approvalRequestId 审批请求 id（可选，供 UI 关联）
	 * @returns 提交后快照
	 */
	async submit(conversationId: string, approvalRequestId?: string): Promise<ComposeModeSnapshot> {
		const snapshot = this.#composeState.submit(conversationId);
		this.#emit({
			type: "compose.submitted",
			persist: true,
			phase: snapshot.phase,
			designFilePath: snapshot.designFilePath,
			...(approvalRequestId === undefined ? {} : { approvalRequestId }),
			conversationId,
		});
		this.#logger.info("compose.submitted", { conversationId });
		return snapshot;
	}

	/**
	 * 审批决议为批准：发 compose.approved（瞬态；落库收口由 exit 完成）
	 * @param conversationId 会话 id
	 */
	async approveOnDecision(conversationId: string): Promise<void> {
		const snapshot = this.#composeState.snapshot(conversationId);
		this.#emit({
			type: "compose.approved",
			persist: false,
			phase: snapshot.phase,
			...(snapshot.designFilePath === undefined ? {} : { designFilePath: snapshot.designFilePath }),
			conversationId,
		});
		this.#logger.info("compose.approved", { conversationId, phase: snapshot.phase });
	}

	/**
	 * 审批决议为驳回：pending → designing，发 compose.rejected（非 pending 时防御性 no-op）
	 * @param conversationId 会话 id
	 */
	async rejectOnDecision(conversationId: string): Promise<void> {
		const current = this.#composeState.snapshot(conversationId);
		if (current.phase !== "pending") return;
		const snapshot = this.#composeState.reject(conversationId);
		this.#emit({
			type: "compose.rejected",
			persist: false,
			phase: snapshot.phase,
			...(snapshot.designFilePath === undefined ? {} : { designFilePath: snapshot.designFilePath }),
			conversationId,
		});
		this.#logger.info("compose.rejected", { conversationId });
	}

	/**
	 * 批准后的落库收口：状态到 applied、草稿归档 archive/、恢复 preMode、发
	 * compose.applied + mode.changed(preMode)、settle。非 active 时 no-op（安全网：
	 * compose 已被放弃/结束时审批决议幂等返回）。
	 * @param conversationId 会话 id
	 * @returns 退出详情
	 */
	async exit(conversationId: string): Promise<ComposeExitDetails> {
		const current = this.#composeState.snapshot(conversationId);
		if (!current.active) {
			this.#logger.debug("compose.exit_idempotent_noop", {
				conversationId,
				phase: current.phase,
			});
			return Object.freeze({
				designFilePath: current.designFilePath ?? "",
				phase: current.phase,
				...(current.preComposeMode === undefined ? {} : { preComposeMode: current.preComposeMode }),
			});
		}
		const snapshot = this.#composeState.approve(conversationId);
		const designFilePath = snapshot.designFilePath ?? "";
		let contentDigest = "";
		let archivePath = "";
		if (designFilePath !== "") {
			try {
				const content = await fs.readFile(designFilePath, "utf8");
				contentDigest = createHash("sha256").update(content).digest("hex");
				const archiveDir = path.join(this.#designRoot, "archive");
				await fs.mkdir(archiveDir, { recursive: true });
				archivePath = path.join(archiveDir, path.basename(designFilePath));
				// Windows：目标已存在时 rename 会失败，先清目标（重复 enter/approve 场景）
				await fs.rm(archivePath, { force: true });
				await fs.rename(designFilePath, archivePath);
			} catch (error) {
				this.#logger.debug("compose.archive_skipped", { conversationId, error: String(error) });
			}
		}
		if (this.#commitRecorder !== undefined && contentDigest !== "") {
			await this.#commitRecorder.record({
				designId: path.basename(designFilePath, ".md"),
				conversationId,
				approvedAt: new Date().toISOString(),
				contentDigest,
				archivePath,
			});
		}
		const mode = snapshot.preComposeMode ?? DEFAULT_CONVERSATION_MODE;
		this.#emit({
			type: "compose.applied",
			persist: true,
			phase: snapshot.phase,
			...(designFilePath === "" ? {} : { designFilePath }),
			...(snapshot.preComposeMode === undefined ? {} : { preComposeMode: snapshot.preComposeMode }),
			conversationId,
		});
		this.#emitModeChanged(conversationId, mode);
		this.#composeState.settle(conversationId);
		this.#logger.info("compose.applied", { conversationId, phase: snapshot.phase });
		return Object.freeze({
			designFilePath,
			phase: snapshot.phase,
			...(snapshot.preComposeMode === undefined ? {} : { preComposeMode: snapshot.preComposeMode }),
		});
	}

	/**
	 * 主动放弃 compose 会话（不走审批门）：恢复 preMode、删 design 文件、发
	 * compose.discarded + mode.changed(preMode)。非 active 时 no-op。
	 * @param conversationId 会话 id
	 */
	async discard(conversationId: string): Promise<void> {
		const current = this.#composeState.snapshot(conversationId);
		if (!current.active) return;
		const preMode = current.preComposeMode ?? DEFAULT_CONVERSATION_MODE;
		await this.#discardActive(conversationId, preMode);
	}

	/**
	 * 用户主动切换 mode 的统一入口（UI 经 CMS 下发 / 其余调用方共用）。
	 * compose 目标走 begin；其余走 setMode；挂起审批或 compose pending 时延迟，
	 * 下一次 applyPendingModeTarget 晋升。
	 * @param conversationId 会话 id
	 * @param target 目标 mode
	 */
	async setMode(conversationId: string, target: ConversationMode): Promise<void> {
		const current = this.#composeState.snapshot(conversationId);
		if (await this.#shouldDefer(conversationId, current.phase)) {
			this.#pendingModeTargets.set(conversationId, target);
			this.#logger.info("compose.mode_deferred_while_pending", { conversationId, target });
			return;
		}
		if (target === "compose") {
			await this.begin(conversationId);
			return;
		}
		if (current.active) {
			// 用户主动退出 compose：discard 路径（不走审批门），落最终 target
			await this.#discardActive(conversationId, target);
			return;
		}
		if (current.mode === target) return;
		this.#composeState.setMode(conversationId, target);
		this.#emitModeChanged(conversationId, target);
		this.#logger.info("compose.mode_set", { conversationId, mode: target });
	}

	/**
	 * 应用审核中延迟的 mode 目标（审批决议后调用）：compose 未激活 → 直接切；
	 * designing active → 走 discard 离开。
	 * @param conversationId 会话 id
	 */
	async applyPendingModeTarget(conversationId: string): Promise<void> {
		const target = this.#pendingModeTargets.get(conversationId);
		if (target === undefined) return;
		this.#pendingModeTargets.delete(conversationId);
		this.#logger.info("compose.mode_deferred_applied", { conversationId, target });
		await this.setMode(conversationId, target);
	}

	/**
	 * 从 state.jsonl 重放恢复会话 mode + compose 子状态（重启补完；不依赖事件订阅，落盘是权威）。
	 * 重放不重复发事件。孤儿 compose（base mode=compose 无 active 会话，或 design 文件缺失）
	 * 防御性回退 review，避免卡死在 compose 无法恢复。
	 * @param conversationId 会话 id
	 * @param events 状态事件序列（readStateEvents 落盘顺序）
	 */
	async hydrateFromEvents(conversationId: string, events: readonly PersistedOutputEvent[]): Promise<void> {
		let baseMode: ConversationMode = DEFAULT_CONVERSATION_MODE;
		for (const event of events) {
			switch (event.type) {
				case "mode.changed":
					// mode.changed("compose") 只由 begin 发出（会话激活标记），不动 base mode
					if (event.mode !== "compose") baseMode = event.mode;
					break;
				case "compose.begin":
					if (!this.#composeState.snapshot(conversationId).active) {
						this.#composeState.enter(conversationId, {
							designFilePath: event.designFilePath,
							preComposeMode: baseMode,
							hasPriorDraft: event.hasPriorDraft,
						});
					}
					break;
				case "compose.submitted":
					if (this.#composeState.snapshot(conversationId).phase === "designing") {
						this.#composeState.submit(conversationId);
					}
					break;
				case "compose.applied":
					if (this.#composeState.snapshot(conversationId).active) {
						this.#composeState.approve(conversationId);
					}
					this.#composeState.settle(conversationId);
					break;
				case "compose.discarded":
					if (this.#composeState.snapshot(conversationId).active) {
						this.#composeState.discard(conversationId);
					}
					break;
				default:
					break;
			}
		}
		const snapshot = this.#composeState.snapshot(conversationId);
		// 孤儿 compose：base mode=compose 但无 active 会话
		if (!snapshot.active && snapshot.mode === "compose") {
			this.#logger.warn("compose.hydrate_orphan_mode", { conversationId });
			this.#composeState.setMode(conversationId, DEFAULT_CONVERSATION_MODE);
		}
		// 孤儿 design：active 但 design 文件已丢失（外部删除）
		if (snapshot.active && snapshot.designFilePath !== undefined) {
			try {
				await fs.access(snapshot.designFilePath);
			} catch {
				this.#logger.warn("compose.hydrate_missing_design_file", {
					conversationId,
					designFilePath: snapshot.designFilePath,
				});
				this.#composeState.discard(conversationId);
				this.#composeState.setMode(conversationId, DEFAULT_CONVERSATION_MODE);
			}
		}
		this.#logger.info("compose.hydrated", {
			conversationId,
			phase: this.#composeState.snapshot(conversationId).phase,
			mode: this.#composeState.snapshot(conversationId).mode,
		});
	}

	/**
	 * 装配事件出口（Conversation 构造后调用：先落 state.jsonl 再 hub 广播）
	 * @param sink 事件出口
	 */
	setEventSink(sink: ComposeEventSink): void {
		this.#eventSink = sink;
	}

	/**
	 * 装配挂起审批探测（coordinator 创建后调用）
	 * @param probe 探测函数
	 */
	setPendingApprovalProbe(probe: (conversationId: string) => Promise<boolean>): void {
		this.#pendingApprovalProbe = probe;
	}

	/** 放弃 active compose 会话（内部）：状态 discard + 删文件 + 发事件 + 落 persistMode */
	async #discardActive(conversationId: string, persistMode: ConversationMode): Promise<void> {
		const discarded = this.#composeState.discard(conversationId);
		await this.#deleteDesignFile(discarded.designFilePath);
		this.#emit({
			type: "compose.discarded",
			persist: true,
			phase: discarded.phase,
			...(discarded.designFilePath === undefined ? {} : { designFilePath: discarded.designFilePath }),
			...(discarded.preComposeMode === undefined ? {} : { preComposeMode: discarded.preComposeMode }),
			conversationId,
		});
		if (persistMode !== discarded.mode) {
			this.#composeState.setMode(conversationId, persistMode);
		}
		this.#emitModeChanged(conversationId, persistMode);
		this.#logger.info("compose.discarded", { conversationId, phase: discarded.phase });
	}

	/** 是否延迟 mode 切换：compose pending 或注入探测报告挂起审批 */
	async #shouldDefer(conversationId: string, phase: ComposeModePhase): Promise<boolean> {
		if (phase === "pending") return true;
		return (await this.#pendingApprovalProbe?.(conversationId)) ?? false;
	}

	/** 删除 design 文件（force；失败仅日志，不阻断） */
	async #deleteDesignFile(designFilePath: string | undefined): Promise<void> {
		if (designFilePath === undefined || designFilePath === "") return;
		try {
			await fs.rm(designFilePath, { force: true });
		} catch (error) {
			this.#logger.debug("compose.discard_cleanup_skipped", { designFilePath, error: String(error) });
		}
	}

	/** 发 mode.changed（persist，唯一权威模式事件） */
	#emitModeChanged(conversationId: string, mode: ConversationMode): void {
		this.#emit({ type: "mode.changed", persist: true, mode, conversationId });
	}

	/** 补 ts 后经 sink 出口 */
	#emit(event: EmitEvent): void {
		this.#eventSink({ ...event, ts: new Date().toISOString() } as OutputEvent);
	}
}
