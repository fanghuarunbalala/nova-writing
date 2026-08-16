// subagent 任务契约（纯类型，全进程共享）：Agent 工具的派生端口 + 任务快照

/** subagent 任务状态（进程内派生即 running，无 queued） */
export type SubagentTaskStatus = "running" | "completed" | "failed" | "cancelled";

/** subagent 任务快照（TaskOutput 工具的返回形态） */
export interface SubagentTaskSnapshot {
  /** 任务 id（runtime 内唯一，task_<seq>） */
  taskId: string;
  /** 派生任务的 agent 类型（如 Explore） */
  agentType: string;
  /** 任务状态 */
  status: SubagentTaskStatus;
  /** 最终 assistant 内容（仅终态有值） */
  result?: string;
  /** 失败原因（仅 failed 态有值） */
  error?: string;
  /** 创建时间 */
  createdAt: string;
  /** 最近更新时间 */
  updatedAt: string;
}

/** Agent 工具 spawn 受理结果（同步返回，任务异步执行） */
export interface SubagentSpawnAcceptance {
  /** 任务 id */
  taskId: string;
  /** 受理状态（进程内派生即 running） */
  status: "running";
}

/** TaskStop 工具返回三态 */
export type SubagentStopOutcome = "cancellation_requested" | "already_terminal" | "not_found";

/**
 * subagent 派生端口：Agent/TaskOutput/TaskStop 工具闭包捕获，由 SubagentRuntime 实现。
 * 工具定义层只依赖本契约，不依赖 conversation/server 实现。
 */
export interface SubagentSpawner {
  /**
   * 派生 subagent 任务：同步受理（返回 acceptance），任务异步执行
   * @param req agentType + 任务 prompt
   * @returns 受理结果（taskId 唯一）
   */
  spawn(req: { agentType: string; prompt: string }): SubagentSpawnAcceptance;

  /**
   * 查询任务快照（未知 taskId 忽略，不在结果内）
   * @param taskIds 目标任务 id 列表
   * @returns 快照列表
   */
  queryTasks(taskIds: readonly string[]): Promise<readonly SubagentTaskSnapshot[]>;

  /**
   * 停止任务
   * @param taskId 目标任务 id
   * @returns 三态结果
   */
  stopTask(taskId: string): Promise<SubagentStopOutcome>;
}
