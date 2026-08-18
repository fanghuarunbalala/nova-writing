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
import { AutoCompactPolicy } from "../compact/definitions/auto-compact.js";
import { AgentLoop } from "../loop/AgentLoop.js";
import { AgentAssembler } from "./AgentAssembler.js";
import { novelAgentDefinition } from "./definitions/NovelAgentDefinition.js";
import { novelSectionRegistry } from "./definitions/novelSections.js";
import { createSubagentTools } from "../tool/definitions/subagent.js";
import type { SubagentToolsOptions } from "../tool/definitions/subagent.js";
import { NOVEL_SUBAGENT_DEFINITIONS } from "./definitions/index.js";
import {
  NOVEL_TOOL_GROUP_CATALOG,
  createNovelToolGroupResolver,
} from "../tool/groups/NovelToolGroups.js";
import type { NovelHandle } from "../../novel/client/NovelHandle.js";
import type { Logger } from "../../log/Logger.js";
import type { LoopContextListener } from "../loop/types.js";
import type { ProviderCallDebugger } from "../debug/ProviderCallDebugger.js";
import type { LLMessage } from "../provider/types.js";
import {
  ComposeModeService,
  ComposeModeStateProvider,
} from "../../conversation/compose/index.js";
import type { ConversationTodoStore } from "../todo/TodoProtocol.js";
import { InMemoryConversationTodoStore } from "../todo/InMemoryConversationTodoStore.js";
import { join } from "node:path";
import { TodoIdleNudgePolicy } from "../nudge/definitions/todo.js";
import { ComposeModeNudgePolicy } from "../nudge/definitions/compose.js";
import { ProjectStageNudgePolicy } from "../nudge/definitions/project-stage.js";
import type {
	AskQuestionAnswer,
	ConversationApprovalDecision,
	ConversationApprovalRequest,
} from "../../conversation/contract/types/index.js";
import type { AskUserChannel } from "../tool/definitions/askUser.js";
import type { LibraryReadDeps } from "../tool/definitions/library.js";

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
  /** 按 run 边界恢复（journal 重放；压缩分区/摘要标记跨重启保持，提供时优先于 runMessages） */
  resumeRuns?: readonly { seq: number; messages: LLMessage[]; ts?: string }[];
  /** run seq 起始值（journal 恢复：resumeSeq = journal.lastSeq） */
  resumeSeq?: number;
  /** 审批通道（mutation 工具执行前征询；子进程内闭包 → conv.sendApprovalRequest） */
  requestApproval?: (req: ConversationApprovalRequest) => Promise<ConversationApprovalDecision>;
  /** 提问通道（AskUserQuestion 工具挂起等待作者作答；子进程内闭包 → conv.sendAskingQuestionRequest） */
  requestAsk?: AskUserChannel;
  /** 暂停点续跑决策器（重启补完路径：CMS takeDecisions 装配） */
  resumePendingDecider?: (toolCallId: string) => Promise<"approve" | "reject" | "expired" | undefined>;
  /** 结构化日志（pino；provider 调用错误可见性） */
  logger?: Logger;
  /** ProviderCall 调试器（debug 模式注入；记录每次请求 + 相邻差异，jsonl + html 增量） */
  debugger?: ProviderCallDebugger;
  /** 宿主平台显示名（core.environment 动态段；缺省不渲染环境块） */
  platform?: string;
  /** 小说全局约束提供者（node 层每调用读 NOVEL.md；失败返回 undefined → 动态段占位） */
  novelConstraintsProvider?: NovelConstraintsProvider;
  /** compose 模式状态提供者（compose_mode nudge 装配；缺省不注入该 nudge） */
  composeState?: ComposeModeStateProvider;
  /** compose 工具服务（novel.compose 组 Enter/ExitComposeMode；缺省用 composeState 自建兜底） */
  composeService?: ComposeModeService;
  /** 每次 provider call 发起前回调（mode pending→active 晋升；经 LoopContext.toProviderCall 步骤⓪ await） */
  beforeProviderCall?: () => void | Promise<void>;
  /** compose_mode sparse 刷新节奏（每多少次 provider call；缺省 5） */
  composeSparseEveryCalls?: number;
  /** Todo 存储（runtime.todo 组 TodoWrite 装配；缺省 InMemoryConversationTodoStore） */
  todoStore?: ConversationTodoStore;
  /** 书库服务（library.read 组）：main 暂不接入（定义已移除该组）；book-analyst 分支恢复 */
  library?: { deps: LibraryReadDeps };
  /** subagent 派发三工具装配（agents/allowedAgentTypes 由 builder 注入定义目录常量，调用方只传 spawner） */
  subagent?: Omit<SubagentToolsOptions, "agents" | "allowedAgentTypes">;
  /** 自动压缩阈值覆盖（设置页 RuntimeSettings.compaction；缺省项用策略默认值） */
  compact?: {
    t1Ratio?: number;
    t2CapRatio?: number;
    summaryMaxTokens?: number;
  };
}

/**
 * 装配完整 Novel Agent（main agent）
 * @param opts 装配选项（声明式定义 + 运行时依赖）
 * @returns AgentLoop（含完整 AgentCapability + 工具调度）
 */
export function buildNovelAgent(opts: NovelAgentOptions): AgentLoop {
  const definition = opts.definition ?? novelAgentDefinition;
  const todoStore = opts.todoStore ?? new InMemoryConversationTodoStore();
  // compose 状态权威实例：nudge / 工具 / 权限门共享；显式传入时由上层 hydrate 后注入
  const composeState = opts.composeState ?? new ComposeModeStateProvider();
  // compose 工具服务：缺省自建兜底（designRoot = workspace/.novel/design），生产由上层注入（T10）
  const composeService =
    opts.composeService ??
    new ComposeModeService({
      composeState,
      designRoot: join(opts.workspace, ".novel", "design"),
    });
  // nudge 实现目录：definition.nudgeEnablement.enabled ∩ 本目录 → 注入。
  // todo_idle / project_stage 恒可注入（project_stage 依赖 opts.handle，必传项）；
  // compose_mode 依赖显式 composeState（hydrate 后注入，缺省不生效）。
  const nudgeCatalog: ReadonlyMap<string, () => ContextNudgePolicy> = new Map<
    string,
    () => ContextNudgePolicy
  >([
    ["todo_idle", () => new TodoIdleNudgePolicy()],
    ["project_stage", () => new ProjectStageNudgePolicy({ handle: opts.handle })],
    ...(opts.composeState === undefined
      ? []
      : ([
          [
            "compose_mode",
            () =>
              new ComposeModeNudgePolicy(
                composeState,
                opts.conversationId ?? "",
                opts.composeSparseEveryCalls === undefined
                  ? {}
                  : { sparseEveryCalls: opts.composeSparseEveryCalls },
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
      compose: { service: composeService, conversationId: opts.conversationId ?? "" },
      ...(opts.requestAsk !== undefined
        ? { ask: { channel: opts.requestAsk, conversationId: opts.conversationId ?? "" } }
        : {}),
      ...(opts.library !== undefined ? { library: opts.library } : {}),
    }),
    nudgeCatalog,
    // 自动上下文压缩（docs/PRD/context-compact.md）：以 provider 闭包构造，
    // 阈值信号/窗口查询/摘要调用都走会话同一 provider；阈值可经 opts.compact 覆盖
    compactPolicies: [new AutoCompactPolicy(opts.provider, { logger: opts.logger, ...opts.compact })],
  });
  const capability = assembler.assemble();
  // subagent 派发三工具（Agent/TaskOutput/TaskStop）：组系统外追加——
  // groupIds 契约不含 subagent 组。白名单由 definition.delegation 派生
  // （声明即生效，无平行常量；delegation 禁用时 allowedAgentTypes 恒空，
  // createSubagentTools 对空白名单抛错，误配即暴露）。
  if (opts.subagent !== undefined) {
    capability.toolDefs.push(
      ...createSubagentTools({
        ...opts.subagent,
        agents: NOVEL_SUBAGENT_DEFINITIONS,
        allowedAgentTypes: definition.delegation.allowedAgentTypes,
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
    restoreRuns: opts.resumeRuns,
    startSeq: opts.resumeSeq,
    requestApproval: opts.requestApproval,
    resumePendingDecider: opts.resumePendingDecider,
    logger: opts.logger,
    debugger: opts.debugger,
    platform: opts.platform,
    novelConstraintsProvider: opts.novelConstraintsProvider,
    composeState,
    beforeProviderCall: opts.beforeProviderCall,
  });
}
