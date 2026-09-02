/**
 * subagent 派发三工具（Agent / TaskOutput / TaskStop）。
 * 对齐旧 main 分支被模型接受的契约：Agent 非阻塞受理 → TaskOutput 查询/阻塞等待 → TaskStop 三态。
 */
import type { ToolDef } from "../ToolDef.js";
import type { ToolCall } from "../../provider/types.js";
import type { SubagentSpawner } from "../../../conversation/contract/task.js";
import { ToolError } from "../errors.js";
import { agentTaskPreview, taskOutputPreview, taskStopPreview } from "../previews.js";

/**
 * 子代理目录条目：Agent 工具描述渲染所需的最小字段集。
 * 与 AgentDefinition 值对象解耦——subagent 装配不在本期 AgentAssembler 范围，
 * 目录只需展示字段（agentType/label/description/allow 名单）。
 */
export interface SubagentCatalogEntry {
  /** Agent 类型 */
  readonly agentType: string;
  /** 展示名 */
  readonly label: string;
  /** 描述（Agent 工具描述渲染来源） */
  readonly description: string;
  /** 工具策略（仅渲染用：allow 名单追加「（工具：...）」行） */
  readonly tools?: { readonly allow?: readonly string[] };
}

/** 解析 tool args JSON */
function parseArgs<T>(call: ToolCall): T {
  try {
    return JSON.parse(call.args) as T;
  } catch {
    throw new ToolError(
      { code: "TOOL_ARGUMENTS_INVALID", toolName: call.name },
      `无效的 JSON 参数: ${call.args}`,
    );
  }
}

/** 异步等待（不阻塞事件循环） */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** TaskOutput block 缺省超时（毫秒） */
export const DEFAULT_TASK_OUTPUT_TIMEOUT_MS = 30_000;
/** TaskOutput block 缺省轮询间隔（毫秒） */
export const DEFAULT_TASK_OUTPUT_POLL_INTERVAL_MS = 250;

/** subagent 三工具装配选项 */
export interface SubagentToolsOptions {
  /** subagent 派生端口（闭包捕获，由 SubagentRuntime 实现） */
  spawner: SubagentSpawner;
  /** 可派生子代理定义目录（Agent 工具描述渲染来源） */
  agents: readonly SubagentCatalogEntry[];
  /** 可派生子代理类型白名单（旧 SubagentToolCompositionPolicy.allowedAgentTypes 等价物；Agent schema enum 推导来源） */
  allowedAgentTypes: readonly string[];
  /** TaskOutput block 缺省超时（毫秒） */
  defaultTimeoutMs?: number;
  /** TaskOutput block 轮询间隔（毫秒） */
  pollIntervalMs?: number;
}

/**
 * 校验子代理白名单（对齐旧 captureSubagentToolCompositionPolicy）：
 * 非空、逐项须在定义目录中（否则 TOOL_POLICY_INVALID）、去重保序。
 * @param agents 子代理定义目录
 * @param allowedAgentTypes 白名单
 * @returns 去重后的白名单（保序）
 */
function validateAgentWhitelist(
  agents: readonly SubagentCatalogEntry[],
  allowedAgentTypes: readonly string[],
): string[] {
  if (allowedAgentTypes.length === 0) {
    throw new ToolError({ code: "TOOL_POLICY_INVALID", toolName: "Agent" }, "子代理白名单不能为空");
  }
  const byType = new Map(agents.map((a) => [a.agentType, a]));
  const result: string[] = [];
  const seen = new Set<string>();
  for (const agentType of allowedAgentTypes) {
    if (!byType.has(agentType)) {
      throw new ToolError(
        { code: "TOOL_POLICY_INVALID", toolName: "Agent" },
        `子代理白名单含未注册类型: ${agentType}`,
      );
    }
    if (!seen.has(agentType)) {
      seen.add(agentType);
      result.push(agentType);
    }
  }
  return result;
}

/**
 * 渲染 Agent 工具描述（对齐旧 createAgentDescription 模板）：
 * 何时用 / 工作流 / 非阻塞语义 + 允许的子代理类型逐项
 * `- agentType（label）：description`，定义 tools.allow 存在时追加 `（工具：...）` 行。
 * @param agents 子代理定义目录（白名单已校验）
 * @param agentTypes 去重后的白名单（按序渲染）
 * @returns Agent 工具描述文本
 */
function createAgentDescription(agents: readonly SubagentCatalogEntry[], agentTypes: readonly string[]): string {
  const byType = new Map(agents.map((a) => [a.agentType, a]));
  const lines = agentTypes.map((agentType) => {
    const def = byType.get(agentType)!;
    const toolList = def.tools?.allow === undefined ? "" : `\n  （工具：${def.tools.allow.join("、")}）`;
    return `- ${def.agentType}（${def.label}）：${def.description}${toolList}`;
  });
  return [
    "派生一个进程内子代理（subagent）执行独立任务。",
    "",
    "## 何时使用",
    "1. 独立的只读探索/调研任务（如盘点角色、核对设定、检索伏笔）",
    "2. 需要并行推进的多步工作（每个任务一个独立子代理）",
    "3. 不想把探索过程占满主对话上下文时",
    "",
    "## 工作流",
    "1. Agent：派生任务，立即返回 taskId（非阻塞，任务异步执行）",
    "2. TaskOutput：查询任务快照；block=true 时阻塞等待任一目标任务进入终态",
    "3. TaskStop：中途停止某个任务",
    "",
    "## 语义",
    "- 派生立即受理（status: running），主对话不被任务阻塞",
    "- taskId 由系统分配（task_<seq>），工具结果里原样回传",
    "- prompt 是子代理任务的完整指令，写清楚要查什么、要返回什么",
    "",
    "## 允许的子代理类型",
    ...lines,
  ].join("\n");
}

/** TaskOutput 工具描述 */
const TASK_OUTPUT_DESCRIPTION = [
  "查询一个或多个 subagent 任务的执行状态与结果。",
  "",
  "block=true 时阻塞等待：任一目标任务进入终态（completed/failed/cancelled）立即返回全部快照；超时（缺省 30 秒）返回当前快照。",
  "block 缺省 false：立即返回当前快照。",
].join("\n");

/** TaskStop 工具描述 */
const TASK_STOP_DESCRIPTION = [
  "停止一个 subagent 任务。",
  "",
  "返回三态：cancellation_requested（已请求取消）/ already_terminal（任务已结束，无需取消）/ not_found（任务不存在）。",
].join("\n");

/**
 * 创建 subagent 派发三工具（Agent / TaskOutput / TaskStop）。
 * Agent 的 schema enum 与描述由定义目录 + 白名单推导（旧 SubagentToolCompositionPolicy 语义）。
 * @param opts 装配选项（spawner 闭包捕获 + 定义目录/白名单 + 轮询参数）
 * @returns 三个工具定义
 */
export function createSubagentTools(opts: SubagentToolsOptions): ToolDef[] {
  const timeoutMs = opts.defaultTimeoutMs ?? DEFAULT_TASK_OUTPUT_TIMEOUT_MS;
  const intervalMs = opts.pollIntervalMs ?? DEFAULT_TASK_OUTPUT_POLL_INTERVAL_MS;
  const agentTypes = validateAgentWhitelist(opts.agents, opts.allowedAgentTypes);

  const agentTool: ToolDef = {
    name: "Agent",
    version: "1.0.0",
    preview: agentTaskPreview,
    description: createAgentDescription(opts.agents, agentTypes),
    parameters: {
      type: "object",
      properties: {
        agentType: {
          type: "string",
          enum: [...agentTypes],
          description: "要派生的子代理类型",
        },
        prompt: {
          type: "string",
          description: "子代理任务的完整指令",
        },
      },
      required: ["agentType", "prompt"],
      additionalProperties: false,
    },
    promptDetail: {
      // 工具优先级（system 恒可见）：委托纪律——独立探索/草案走子代理，不与子代理重复劳动
      policy:
        "独立只读探索与草案创作委托 Explore / Compose；已委托给子代理的工作不要自己重复做。",
      guidance: "",
    },
    handler: {
      execute: async (call) => {
        const { agentType, prompt } = parseArgs<{ agentType: string; prompt: string }>(call);
        const acceptance = opts.spawner.spawn({ agentType, prompt });
        return JSON.stringify(acceptance, null, 2);
      },
    },
  };

  const taskOutputTool: ToolDef = {
    name: "TaskOutput",
    version: "1.0.0",
    preview: taskOutputPreview,
    description: TASK_OUTPUT_DESCRIPTION,
    parameters: {
      type: "object",
      properties: {
        taskIds: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          description: "目标任务 id 列表（Agent 工具返回的 taskId）",
        },
        block: {
          type: "boolean",
          description: "true 时阻塞等待任一目标任务终态",
        },
        timeout: {
          type: "integer",
          description: "block 超时（毫秒，缺省 30000）",
        },
      },
      required: ["taskIds"],
      additionalProperties: false,
    },
    promptDetail: {
      policy: "",
      guidance: "",
    },
    handler: {
      execute: async (call) => {
        const { taskIds, block, timeout } = parseArgs<{
          taskIds: string[];
          block?: boolean;
          timeout?: number;
        }>(call);
        if (!block) {
          const snapshots = await opts.spawner.queryTasks(taskIds);
          return JSON.stringify(snapshots, null, 2);
        }
        const deadline = Date.now() + (timeout ?? timeoutMs);
        for (;;) {
          const snapshots = await opts.spawner.queryTasks(taskIds);
          if (snapshots.some((s) => s.status !== "running")) {
            return JSON.stringify(snapshots, null, 2);
          }
          if (Date.now() >= deadline) {
            return JSON.stringify(snapshots, null, 2);
          }
          await sleep(intervalMs);
        }
      },
    },
  };

  const taskStopTool: ToolDef = {
    name: "TaskStop",
    version: "1.0.0",
    preview: taskStopPreview,
    description: TASK_STOP_DESCRIPTION,
    parameters: {
      type: "object",
      properties: {
        taskId: {
          type: "string",
          description: "要停止的任务 id",
        },
      },
      required: ["taskId"],
      additionalProperties: false,
    },
    promptDetail: {
      policy: "",
      guidance: "",
    },
    handler: {
      execute: async (call) => {
        const { taskId } = parseArgs<{ taskId: string }>(call);
        const outcome = await opts.spawner.stopTask(taskId);
        return JSON.stringify({ outcome }, null, 2);
      },
    },
  };

  return [agentTool, taskOutputTool, taskStopTool];
}
