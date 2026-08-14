/**
 * Novel Agent 装配：声明式定义（novelAgentDefinition）经 AgentAssembler 解析为
 * 完整 main agent（system 分节 + 全部工具 + 工具调度）。
 * 对齐旧 NovelAgentDefinition（agentType="novel"）；compose nudge 由 Conversation 层注入（依赖 ConversationContext）。
 */
import type { Provider } from "../provider/Provider.js";
import type { AgentDefinition } from "./AgentDefinition.js";
import type { ToolDispatcher } from "../tool/ToolDispatcher.js";
import type { DynamicInputProvider } from "../prompt/PromptSection.js";
import type { ContextNudgePolicy } from "../nudge/ContextNudgePolicy.js";
import { AgentLoop } from "../loop/AgentLoop.js";
import { AgentAssembler } from "./AgentAssembler.js";
import {
  novelAgentDefinition,
  novelSectionRegistry,
} from "./definitions/NovelAgentDefinition.js";
import {
  NOVEL_TOOL_GROUP_CATALOG,
  createNovelToolGroupResolver,
} from "./definitions/NovelToolGroups.js";
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
  /** conversation id（产出 OutputEvent 用；缺省 undefined） */
  conversationId?: string;
  /** 状态变化监听器（journal 落盘由上层注入 journalListener） */
  listeners?: LoopContextListener[];
  /** 可恢复的 turn 消息（journal 重放；缺省从空开始） */
  turnMessages?: LLMessage[];
  /** turn seq 起始值（journal 恢复：resumeSeq = journal.lastSeq） */
  resumeSeq?: number;
  /** 审批通道（mutation 工具执行前征询；子进程内闭包 → conv.sendApprovalRequest） */
  requestApproval?: (req: ConversationApprovalRequest) => Promise<ConversationApprovalDecision>;
  /** 暂停点续跑决策器（重启补完路径：CMS takeDecisions 装配） */
  resumePendingDecider?: (toolCallId: string) => Promise<"approve" | "reject" | "expired" | undefined>;
  /** 结构化日志（pino；provider 调用错误可见性） */
  logger?: Logger;
  /** 动态段输入提供者（node 层注入 workdir/platform/NOVEL.md；缺省空输入） */
  dynamicInput?: DynamicInputProvider;
  /** compose 模式状态提供者（compose_mode nudge 装配；缺省不注入该 nudge） */
  composeState?: ComposeModeStateProvider;
  /** Todo 存储（runtime.todo 组 TodoWrite 装配；缺省 InMemoryConversationTodoStore） */
  todoStore?: ConversationTodoStore;
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
  const dispatcher: ToolDispatcher = {
    dispatch: async (_ctx, call) => {
      const tool = capability.toolDefs.find((t) => t.name === call.name);
      if (!tool) throw new Error(`未知工具: ${call.name}`);
      return tool.handler.execute(call);
    },
  };
  return new AgentLoop({
    workspace: opts.workspace,
    provider: opts.provider,
    agentCapability: capability,
    toolDispatcher: dispatcher,
    agentId: "main",
    conversationId: opts.conversationId,
    listeners: opts.listeners,
    turnMessages: opts.turnMessages,
    startSeq: opts.resumeSeq,
    requestApproval: opts.requestApproval,
    resumePendingDecider: opts.resumePendingDecider,
    logger: opts.logger,
    dynamicInput: opts.dynamicInput,
  });
}
