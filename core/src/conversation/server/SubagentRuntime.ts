/**
 * SubagentRuntime：conversation 进程内 subagent 任务编排（spawn / 查询 / 停止 / 事件桥）。
 * 对齐 architecture.md 概念模型：subagent 无独立进程/持久化，事件仅 live 进 hub（不落 journal）。
 */
import type { AgentLoop } from "../../runtime/loop/AgentLoop.js";
import type { SamplingConfig } from "../../runtime/provider/types.js";
import { ToolError } from "../../runtime/tool/errors.js";
import type { OutputEvent } from "../contract/events/index.js";
import type {
  SubagentSpawnAcceptance,
  SubagentSpawner,
  SubagentStopOutcome,
  SubagentTaskSnapshot,
} from "../contract/task.js";

/** subagent 任务缺省最大轮次（防死循环） */
export const DEFAULT_SUBAGENT_MAX_TURNS = 20;

/** 并发 running 任务上限（超限拒绝派生，防资源耗尽） */
export const DEFAULT_MAX_CONCURRENT_TASKS = 8;

/** 终态快照保留条数上限（LRU 淘汰，防任务表无限增长；result 不截断——TaskOutput 依赖完整内容） */
export const TERMINAL_SNAPSHOT_RETAIN = 20;

/** SubagentRuntime 构造选项 */
export interface SubagentRuntimeOptions {
	/** 采样配置（继承 conversation 同一对象） */
	sampling: SamplingConfig;
	/** 单任务最大轮次（超限抛错 → failed） */
	maxTurns?: number;
	/** 并发 running 任务上限（缺省 8） */
	maxConcurrent?: number;
  /**
   * agentType → loop 工厂：每任务新建 loop。
   * 闭包内必须为每个 loop 建 fresh Provider（Provider 实例带流式累积状态，不可跨 loop 共享）；
   * loop 一次性使用（cancel 永久中止其 AbortController），不复用。
   */
  builders: Readonly<Record<string, (agentId: string) => AgentLoop>>;
}

/** 单任务内部记录 */
interface TaskRecord {
  snapshot: SubagentTaskSnapshot;
  loop?: AgentLoop;
}

/**
 * conversation 进程内 subagent 任务编排器（每 conversation 一个实例）。
 *
 * 不变量：
 * - live-only：本类绝不向 AgentLoopConfig 传 listeners（builder 契约同样只读装配），
 *   subagent 事件只经 onEvent 进 conversation hub，journal 只 main 落盘。
 * - 终态不覆盖：任务被 cancelled 后，loop.run 晚到的 settle 不得改写 cancelled 快照。
 */
export class SubagentRuntime implements SubagentSpawner {
  /** 采样配置 */
  private readonly sampling: SamplingConfig;
  /** 单任务最大轮次 */
  private readonly maxTurns: number;
  /** agentType → loop 工厂 */
  private readonly builders: Readonly<Record<string, (agentId: string) => AgentLoop>>;
	/** 任务注册表（taskId → 记录） */
	private readonly tasks = new Map<string, TaskRecord>();
	/** 终态任务淘汰顺序（插入序，LRU） */
	private readonly terminalOrder: string[] = [];
	/** 并发上限 */
	private readonly maxConcurrent: number;
  /** 任务序号（task_<seq>） */
  private taskSeq = 0;
  /** 输出事件订阅者（→ conversation hub） */
  private readonly eventListeners = new Set<(e: OutputEvent) => void>();

  /**
   * 构造 SubagentRuntime
   * @param opts 采样 + 最大轮次 + loop 工厂
   */
	constructor(opts: SubagentRuntimeOptions) {
		this.sampling = opts.sampling;
		this.maxTurns = opts.maxTurns ?? DEFAULT_SUBAGENT_MAX_TURNS;
		this.maxConcurrent = opts.maxConcurrent ?? DEFAULT_MAX_CONCURRENT_TASKS;
		this.builders = opts.builders;
	}

  /**
   * 派生 subagent 任务：同步受理（返回 acceptance），任务异步执行。
   * 未知 agentType 抛 ToolError TOOL_NOT_AVAILABLE（对齐主 dispatcher 未知工具归一）。
   * @param req agentType + 任务 prompt
   * @returns 受理结果（taskId 唯一）
   */
	spawn(req: { agentType: string; prompt: string }): SubagentSpawnAcceptance {
		const builder = this.builders[req.agentType];
		if (!builder) {
			throw new ToolError(
				{ code: "TOOL_NOT_AVAILABLE", toolName: "Agent" },
				`未知 agent 类型: ${req.agentType}`,
			);
		}
		// 并发上限：running 任务数超限拒绝派生（防 provider/内存资源耗尽）
		let running = 0;
		for (const t of this.tasks.values()) {
			if (t.snapshot.status === "running") running++;
		}
		if (running >= this.maxConcurrent) {
			throw new ToolError(
				{ code: "TOOL_HANDLER_FAILED", toolName: "Agent" },
				`并发 subagent 任务已达上限 ${this.maxConcurrent}，请先等待或停止现有任务`,
			);
		}
    const taskId = `task_${++this.taskSeq}`;
    const agentId = `${req.agentType}:${taskId}`;
    const now = new Date().toISOString();
    const record: TaskRecord = {
      snapshot: {
        taskId,
        agentType: req.agentType,
        status: "running",
        createdAt: now,
        updatedAt: now,
      },
    };
    const loop = builder(agentId);
    record.loop = loop;
    this.tasks.set(taskId, record);
    // 先订阅事件再启动（不丢首轮事件）
    const unsubscribe = loop.onOutputEvent((e) => this.dispatch(e));
    void this.runTask(record, req.prompt, unsubscribe);
    return { taskId, status: "running" };
  }

  /**
   * 查询任务快照（未知 taskId 忽略）
   * @param taskIds 目标任务 id 列表
   * @returns 快照列表（按请求顺序）
   */
  async queryTasks(taskIds: readonly string[]): Promise<readonly SubagentTaskSnapshot[]> {
    const out: SubagentTaskSnapshot[] = [];
    for (const id of taskIds) {
      const record = this.tasks.get(id);
      if (record) out.push(record.snapshot);
    }
    return out;
  }

  /**
   * 停止任务：running → 标记 cancelled + loop.cancel()；终态不覆盖。
   * @param taskId 目标任务 id
   * @returns 三态结果
   */
  async stopTask(taskId: string): Promise<SubagentStopOutcome> {
    const record = this.tasks.get(taskId);
    if (!record) return "not_found";
    if (record.snapshot.status !== "running") return "already_terminal";
    record.snapshot = {
      ...record.snapshot,
      status: "cancelled",
      updatedAt: new Date().toISOString(),
    };
    record.loop?.cancel();
    return "cancellation_requested";
  }

	/** 停止全部任务（conversation stop/dispose 级联） */
	stopAll(): void {
		for (const [taskId] of this.tasks) {
			if (this.tasks.get(taskId)?.snapshot.status === "running") {
				void this.stopTask(taskId).catch(() => {
					// stopTask 自身不抛（not_found/终态返回值）；兜底防 unhandled rejection 杀进程
				});
			}
		}
	}

  /** 订阅输出事件（subagent loop 事件 → conversation hub），返回取消订阅 */
  onEvent(l: (e: OutputEvent) => void): () => void {
    this.eventListeners.add(l);
    return () => this.eventListeners.delete(l);
  }

	/** 执行任务：订阅循环已就位，await 结果写终态；finally 退订 + 终态回收 */
	private async runTask(record: TaskRecord, prompt: string, unsubscribe: () => void): Promise<void> {
		const loop = record.loop;
		if (!loop) return;
		try {
			const result = await loop.run(prompt, { sampling: this.sampling, maxTurns: this.maxTurns });
			if (record.snapshot.status !== "cancelled") {
				record.snapshot = {
					...record.snapshot,
					status: "completed",
					result: result.final.content,
					updatedAt: new Date().toISOString(),
				};
			}
		} catch (err) {
			// cancelled 不覆盖（stopTask 已写终态）
			if (record.snapshot.status !== "cancelled") {
				record.snapshot = {
					...record.snapshot,
					status: "failed",
					error: err instanceof Error ? err.message : String(err),
					updatedAt: new Date().toISOString(),
				};
			}
		} finally {
			unsubscribe();
			// 本任务已终态：登记回收序并淘汰超额终态快照
			this.terminalOrder.push(record.snapshot.taskId);
			while (this.terminalOrder.length > TERMINAL_SNAPSHOT_RETAIN) {
				this.tasks.delete(this.terminalOrder.shift()!);
			}
		}
	}

  /** 分发输出事件给所有订阅者 */
  private dispatch(e: OutputEvent): void {
    for (const l of this.eventListeners) l(e);
  }
}
