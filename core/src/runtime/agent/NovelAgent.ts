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
import type { ToolDef } from "../tool/ToolDef.js";
import type {
  NovelConstraintsProvider,
  CaseGuideProvider,
  MemoryIndexProvider,
} from "../prompt/PromptSection.js";
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
import { ExternalToolsNudgePolicy } from "../nudge/definitions/external-tools.js";
import { DeferredToolRegistry } from "../tool/deferred/DeferredToolRegistry.js";
import { createDeferredRejectionStub } from "../tool/definitions/externalTools.js";
import type {
	AskQuestionAnswer,
	ConversationApprovalDecision,
	ConversationApprovalRequest,
} from "../../conversation/contract/types/index.js";
import type { AskUserChannel } from "../tool/definitions/askUser.js";
import type { LibraryReadDeps } from "../tool/definitions/library.js";
import type { SkillRegistry } from "../skill/SkillRegistry.js";
import type { SamplingConfig } from "../provider/types.js";
import { readNovelGlobalConstraintsLayersSafe } from "../../node/workspace/readNovelGlobalConstraints.js";
import { readMemoryIndexForInjection } from "../../memory/MemoryStore.js";
import type { RunContext } from "../loop/types.js";

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
  /**
   * 案例引导提供者（node 层 seed + 扫描 .novel/cases）：质量规范段「参考案例」
   * 小节的条目来源（main 与 Compose 同源）；缺省仅省略小节。
   */
  caseGuideProvider?: CaseGuideProvider;
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
  /** 技能注册表（runtime.skills 组 skill；缺省=未装配降级。宿主构造并 load 后注入） */
  skills?: { registry: SkillRegistry };
  /**
   * 组外追加工具（docs/PRD/external-tools-接入.md 演进）：MCP 包装工具等宿主派生
   * 工具面不再直进 dispatcher/toolSchemes——全部进延迟池（DeferredToolRegistry），
   * 经 runtime.external 组 SearchExtraTools/ExecuteExtraTool 两步接入，装配期定死。
   */
  extraTools?: readonly ToolDef[];
  /** 书库服务（library.read 组）：main 暂不接入（定义已移除该组）；book-analyst 分支恢复 */
  library?: { deps: LibraryReadDeps };
  /**
   * novel.import 组装配（ProjectImporter 专用）：原始（未守卫）handle——
   * NovelImportText 的确定性写通道。definition.groupIds 含 novel.import 时必传。
   */
  importText?: { handle: NovelHandle };
  /**
   * 全局层 NOVEL.md 绝对路径（PRD memory-两层记忆 M1）：runtime.files 组的沙盒
   * 例外 + 强制审批目标；缺省无全局层（novelConstraintsProvider 自行注入时可不传）。
   */
  globalConstraintsPath?: string;
  /**
   * 动态记忆依赖覆盖（PRD memory-两层记忆 M3）：缺省 staticLayerTexts 读两层
   * NOVEL.md、source 由内部 run 序号追踪器构造（<会话id>#<run序号>）。
   */
  memory?: { staticLayerTexts: () => Promise<readonly (string | undefined)[]> };
  /**
   * 动态记忆索引提供者（PRD memory-两层记忆 M2）：缺省读 workspace memory/
   * MEMORY.md 全量 active 条目（main 语义）；Compose 子代理装配方传 author/feedback
   * 过滤版。
   */
  memoryIndexProvider?: MemoryIndexProvider;
  /**
   * 压缩前提取整理 pass（PRD memory-两层记忆 M4）：仅显式装配（子进程入口为
   * main 会话接线；importer/analyst 后台会话不挂）。
   */
  preCompactPass?: (sampling: SamplingConfig, runs: readonly RunContext[]) => Promise<void>;
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
  // 动态记忆依赖（PRD memory-两层记忆 M3）：恒装配（definition.groupIds 决定工具面
  // 是否解析；main 定义含 runtime.memory）。source = <会话id>#<当前 run 序号>——
  // 监听 run 追加维护序号，模型不可伪造（工具参数不含 source 字段）；
  // staticLayerTexts 缺省读两层 NOVEL.md（skip 机械校验用）
  let memorySourceSeq = opts.resumeSeq ?? 0;
  const memoryDeps = {
    getSource: () => `${opts.conversationId ?? "conv"}#${memorySourceSeq}`,
    staticLayerTexts:
      opts.memory?.staticLayerTexts ??
      (async () => {
        const snap = await readNovelGlobalConstraintsLayersSafe(
          opts.workspace,
          opts.globalConstraintsPath,
        );
        return snap === undefined ? [] : [snap.global, snap.project];
      }),
  };
  // compose 状态权威实例：nudge / 工具 / 权限门共享；显式传入时由上层 hydrate 后注入
  const composeState = opts.composeState ?? new ComposeModeStateProvider();
  // compose 工具服务：缺省自建兜底（designRoot = workspace/.novel/design），生产由上层注入（T10）
  const composeService =
    opts.composeService ??
    new ComposeModeService({
      composeState,
      designRoot: join(opts.workspace, ".novel", "design"),
    });
  // 外部工具延迟池（MCP 包装工具等；docs/PRD/external-tools-接入.md）：
  // 不进常驻工具面（toolSchemes / tool.policy 名单），由 runtime.external 组
  // SearchExtraTools/ExecuteExtraTool 两步接入；受信免审、非受信内嵌审批。
  // 可为空（无 MCP 工具时两工具照常装配，搜索返回「无延迟工具」，nudge no-op）
  const externalRegistry = new DeferredToolRegistry(opts.extraTools ?? []);
  // nudge 实现目录：definition.nudgeEnablement.enabled ∩ 本目录 → 注入。
  // todo_idle / project_stage 恒可注入（project_stage 依赖 opts.handle，必传项）；
  // compose_mode 依赖显式 composeState（hydrate 后注入，缺省不生效）；
  // external_tools 恒可注入（注册表为空时策略 no-op）。
  const nudgeCatalog: ReadonlyMap<string, () => ContextNudgePolicy> = new Map<
    string,
    () => ContextNudgePolicy
  >([
    ["todo_idle", () => new TodoIdleNudgePolicy()],
    [
      "project_stage",
      () => new ProjectStageNudgePolicy({ handle: opts.handle }),
    ],
    [
      "external_tools",
      () => new ExternalToolsNudgePolicy({ registry: externalRegistry }),
    ],
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
      ...(opts.skills !== undefined ? { skills: opts.skills } : {}),
      ...(opts.library !== undefined ? { library: opts.library } : {}),
      ...(opts.importText !== undefined ? { importText: opts.importText } : {}),
      ...(opts.globalConstraintsPath !== undefined
        ? { globalConstraintsPath: opts.globalConstraintsPath }
        : {}),
      memory: memoryDeps,
      // runtime.external 组：延迟池 + 会话 id + 审批通道（ExecuteExtraTool 内嵌审批用）
      external: {
        registry: externalRegistry,
        ...(opts.conversationId === undefined ? {} : { conversationId: opts.conversationId }),
        ...(opts.requestApproval === undefined ? {} : { requestApproval: opts.requestApproval }),
      },
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
  // 组外追加工具演进（docs/PRD/external-tools-接入.md）：extraTools（MCP 包装工具）
  // 已在上方进延迟池（externalRegistry），不再直进 capability.toolDefs——
  // 常驻工具面只含 runtime.external 组的两步工具（SearchExtraTools/ExecuteExtraTool）
  if (opts.subagent !== undefined) {
    capability.toolDefs.push(
      ...createSubagentTools({
        ...opts.subagent,
        agents: NOVEL_SUBAGENT_DEFINITIONS,
        allowedAgentTypes: definition.delegation.allowedAgentTypes,
      }),
    );
  }
  // 技能索引快照（skill.index 动态段数据源）：装配期从生效清单派生一次，
  // 会话期静态（registry 已 load 完成后调用）
  const skillsIndex =
    opts.skills !== undefined && opts.skills.registry.effective().length > 0
      ? {
          entries: opts.skills.registry.effective().map((s) => ({
            name: s.name,
            description: s.description,
          })),
        }
      : undefined;
  const dispatcher = new MapToolDispatcher(capability.toolDefs);
  // 延迟工具直接调用拦截：stub 仅注册进 dispatcher（不进 toolSchemes，故不进
  // 工具名单/provider call）——模型未经 SearchExtraTools 直接调用时抛错引导两步流程
  for (const def of externalRegistry.list()) {
    dispatcher.register(createDeferredRejectionStub(def));
  }
  // 记忆 source 序号追踪（PRD memory-两层记忆 D7）：追加到 opts.listeners 之前，
  // 保证 MemoryWrite 执行时序号已更新（run 追发生在工具执行前）
  const listeners = [
    ...(opts.listeners ?? []),
    { onRunAppended: (run: RunContext) => { memorySourceSeq = run.seq; } },
  ];
  return new AgentLoop({
    workspace: opts.workspace,
    provider: opts.provider,
    agentCapability: capability,
    toolDispatcher: dispatcher,
    agentId: "main",
    conversationId: opts.conversationId,
    listeners,
    runMessages: opts.runMessages,
    restoreRuns: opts.resumeRuns,
    startSeq: opts.resumeSeq,
    requestApproval: opts.requestApproval,
    resumePendingDecider: opts.resumePendingDecider,
    logger: opts.logger,
    debugger: opts.debugger,
    platform: opts.platform,
    novelConstraintsProvider: opts.novelConstraintsProvider,
    caseGuideProvider: opts.caseGuideProvider,
    // 动态记忆索引（缺省读 workspace memory/MEMORY.md 全量 active——main 语义）
    memoryIndexProvider:
      opts.memoryIndexProvider ?? (() => readMemoryIndexForInjection(opts.workspace)),
    ...(opts.preCompactPass !== undefined ? { preCompactPass: opts.preCompactPass } : {}),
    skillsIndex,
    composeState,
    beforeProviderCall: opts.beforeProviderCall,
  });
}
