/**
 * Novel Agent 装配：声明式定义（novelAgentDefinition）经 AgentAssembler 解析为
 * 完整 main agent（system 分节 + 全部工具 + 工具调度）。
 * 对齐旧 NovelAgentDefinition（agentType="novel"）；compose nudge 由 Conversation 层注入（依赖 ConversationContext）。
 * subagent 派发三工具在 opts.subagent 提供时组外追加（subagent 组不在本期
 * groupIds 契约，见 tool/definitions/subagent.ts 说明）。
 */
import type { Provider } from "../provider/Provider.js";
import type { AgentDefinition } from "./AgentDefinition.js";
import { MapToolDispatcher } from "../tool/MapToolDispatcher.js";
import type { NovelConstraintsProvider } from "../prompt/PromptSection.js";
import type { ContextNudgePolicy } from "../nudge/ContextNudgePolicy.js";
import { AgentLoop } from "../loop/AgentLoop.js";
import { AgentAssembler } from "./AgentAssembler.js";
import {
  novelAgentDefinition,
  novelSectionRegistry,
} from "./definitions/NovelAgentDefinition.js";
import { createSubagentTools } from "../tool/definitions/subagent.js";
import type { SubagentToolsOptions } from "../tool/definitions/subagent.js";
import {
  NOVEL_SUBAGENT_DEFINITIONS,
  NOVEL_SUBAGENT_ALLOWED_TYPES,
} from "./NovelExplorerAgent.js";
import {
  NOVEL_TOOL_GROUP_CATALOG,
  createNovelToolGroupResolver,
} from "../tool/groups/NovelToolGroups.js";
import type { NovelHandle } from "../../novel/client/NovelHandle.js";
import type { Logger } from "../../log/Logger.js";
import type { LoopContextListener } from "../loop/types.js";
import type { LLMessage } from "../provider/types.js";
import type { ComposeModeStateProvider } from "../../conversation/compose/ComposeModeState.js";
import type { ConversationTodoStore } from "../todo/TodoProtocol.js";
import { InMemoryConversationTodoStore } from "../todo/InMemoryConversationTodoStore.js";
import { TodoIdleNudgePolicy } from "../nudge/definitions/todo.js";
import { ComposeModeNudgePolicy } from "../nudge/definitions/compose.js";
import type {
  ConversationApprovalDecision,
  ConversationApprovalRequest,
} from "../../conversation/contract/types/index.js";

/** Novel Agent 装配选项 */
export interface NovelAgentOptions {
  /** Agent 定义（声明式配置；缺省 novelAgentDefinition） */
  definition?: AgentDefinition;
  /** 工作区路径（工具文件操作环境） */
  workspace: string;
  /** Provider 实例 */
  provider: Provider;
  /** novel 客户端（工具 query/mutate 对接） */
  handle: NovelHandle;
  /** conversation id（产出 LoopEvent 用；缺省 undefined） */
  conversationId?: string;
  /** 状态变化监听器（journal 落盘由上层注入 journalListener） */
  listeners?: LoopContextListener[];
  /** 可恢复的 run 消息（journal 重放；缺省从空开始） */
  runMessages?: LLMessage[];
  /** run seq 起始值（journal 恢复：resumeSeq = journal.lastSeq） */
  resumeSeq?: number;
  /** 审批通道（mutation 工具执行前征询；子进程内闭包 → conv.sendApprovalRequest） */
  requestApproval?: (req: ConversationApprovalRequest) => Promise<ConversationApprovalDecision>;
  /** 暂停点续跑决策器（重启补完路径：CMS takeDecisions 装配） */
  resumePendingDecider?: (toolCallId: string) => Promise<"approve" | "reject" | "expired" | undefined>;
  /** 结构化日志（pino；provider 调用错误可见性） */
  logger?: Logger;
  /** 宿主平台显示名（core.environment 动态段；缺省不渲染环境块） */
  platform?: string;
  /** 小说全局约束提供者（node 层每调用读 NOVEL.md；失败返回 undefined → 动态段占位） */
  novelConstraintsProvider?: NovelConstraintsProvider;
  /** compose 模式状态提供者（compose_mode nudge 装配；缺省不注入该 nudge） */
  composeState?: ComposeModeStateProvider;
  /** Todo 存储（runtime.todo 组 TodoWrite 装配；缺省 InMemoryConversationTodoStore） */
  todoStore?: ConversationTodoStore;
  /** subagent 派发三工具装配（agents/allowedAgentTypes 由 builder 注入定义目录常量，调用方只传 spawner） */
  subagent?: Omit<SubagentToolsOptions, "agents" | "allowedAgentTypes">;
}

/**
 * 装配完整 Novel Agent（main agent）
 * @param opts 装配选项（声明式定义 + 运行时依赖）
 * @returns AgentLoop（含完整 AgentCapability + 工具调度）
 */
export function buildNovelAgent(opts: NovelAgentOptions): AgentLoop {
  const definition = opts.definition ?? novelAgentDefinition;
  const todoStore = opts.todoStore ?? new InMemoryConversationTodoStore();
  // nudge 实现目录：definition.nudgeEnablement.enabled ∩ 本目录 → 注入。
  // todo_idle 恒可注入；compose_mode 依赖 composeState（compose 状态机接线
  // 不在本期，未传 composeState 时该 nudge 不生效）。
  const nudgeCatalog: ReadonlyMap<string, () => ContextNudgePolicy> = new Map<
    string,
    () => ContextNudgePolicy
  >([
    ["todo_idle", () => new TodoIdleNudgePolicy()],
    ...(opts.composeState === undefined
      ? []
      : ([
          [
            "compose_mode",
            () =>
              new ComposeModeNudgePolicy(
                opts.composeState!,
                opts.conversationId ?? "",
              ),
          ],
        ] as [string, () => ContextNudgePolicy][])),
  ]);
  const assembler = new AgentAssembler({
    definition,
    sectionRegistry: novelSectionRegistry,
    toolGroupCatalog: NOVEL_TOOL_GROUP_CATALOG,
    resolveToolGroup: createNovelToolGroupResolver({
      workspace: opts.workspace,
      handle: opts.handle,
      todoStore,
      todoConversationId: opts.conversationId ?? "",
    }),
    nudgeCatalog,
  });
  const capability = assembler.assemble();
  // subagent 派发三工具（Agent/TaskOutput/TaskStop）：组系统外追加——
  // 本期 groupIds 契约不含 subagent 组；定义 tools 策略只过滤组内工具，
  // 追加工具不受 allow/deny 影响（main agent 全量策略本就不过滤）。
  if (opts.subagent !== undefined) {
    capability.toolDefs.push(
      ...createSubagentTools({
        ...opts.subagent,
        agents: NOVEL_SUBAGENT_DEFINITIONS,
        allowedAgentTypes: NOVEL_SUBAGENT_ALLOWED_TYPES,
      }),
    );
  }
  const dispatcher = new MapToolDispatcher(capability.toolDefs);
  return new AgentLoop({
    workspace: opts.workspace,
    provider: opts.provider,
    agentCapability: capability,
    toolDispatcher: dispatcher,
    agentId: "main",
    conversationId: opts.conversationId,
    listeners: opts.listeners,
    runMessages: opts.runMessages,
    startSeq: opts.resumeSeq,
    requestApproval: opts.requestApproval,
    resumePendingDecider: opts.resumePendingDecider,
    logger: opts.logger,
    platform: opts.platform,
    novelConstraintsProvider: opts.novelConstraintsProvider,
  });
}
