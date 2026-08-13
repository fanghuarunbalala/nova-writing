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

/** SubagentRuntime 构造选项 */
export interface SubagentRuntimeOptions {
  /** 采样配置（继承 conversation 同一对象） */
  sampling: SamplingConfig;
  /** 单任务最大轮次（超限抛错 → failed） */
  maxTurns?: number;
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
        void this.stopTask(taskId);
      }
    }
  }

  /** 订阅输出事件（subagent loop 事件 → conversation hub），返回取消订阅 */
  onEvent(l: (e: OutputEvent) => void): () => void {
    this.eventListeners.add(l);
    return () => this.eventListeners.delete(l);
  }

  /** 执行任务：订阅循环已就位，await 结果写终态；finally 退订 */
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
    }
  }

  /** 分发输出事件给所有订阅者 */
  private dispatch(e: OutputEvent): void {
    for (const l of this.eventListeners) l(e);
  }
}
