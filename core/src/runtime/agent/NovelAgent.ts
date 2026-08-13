/**
 * Novel Agent 装配：组装完整 main agent（system 分节 + 全部工具 + 工具调度）。
 * 对齐旧 NovelAgentDefinition（agentType="novel"）；compose nudge 由 Conversation 层注入（依赖 ConversationContext）。
 */
import type { Provider } from "../provider/Provider.js";
import type { AgentCapability } from "./AgentCapability.js";
import type { ToolDispatcher } from "../tool/ToolDispatcher.js";
import type { ToolDef } from "../tool/ToolDef.js";
import { AgentLoop } from "../loop/AgentLoop.js";
import { createFileTools } from "../tool/definitions/files.js";
import {
  createCharacterTools,
  createLocationTools,
  createOutlineTools,
  createParagraphTools,
  createPublicationTools,
  createDeleteTool,
} from "../tool/definitions/novel.js";
import { createSubagentTools } from "../tool/definitions/subagent.js";
import type { SubagentToolsOptions } from "../tool/definitions/subagent.js";
import {
  coreRuntimeProtocolSection,
  toolGuidanceSection,
} from "../prompt/sections/agent.js";
import {
  novelIdentitySection,
  novelSystemSection,
  novelCraftSection,
  novelExecutionSection,
} from "../prompt/sections/novel.js";
import type { NovelHandle } from "../../novel/client/NovelHandle.js";
import type { Logger } from "../../log/Logger.js";
import type { LoopContextListener } from "../loop/types.js";
import type { LLMessage } from "../provider/types.js";
import type {
  ConversationApprovalDecision,
  ConversationApprovalRequest,
} from "../../conversation/contract/types/index.js";

/** Novel Agent 装配选项 */
export interface NovelAgentOptions {
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
  /** subagent 派发三工具装配（存在时追加 Agent/TaskOutput/TaskStop） */
  subagent?: SubagentToolsOptions;
}

/**
 * 装配完整 Novel Agent（main agent）
 * @param opts 装配选项
 * @returns AgentLoop（含完整 AgentCapability + 工具调度）
 */
export function buildNovelAgent(opts: NovelAgentOptions): AgentLoop {
  const toolDefs: ToolDef[] = [
    ...createFileTools(opts.workspace),
    ...createCharacterTools(opts.handle),
    ...createLocationTools(opts.handle),
    ...createOutlineTools(opts.handle),
    ...createParagraphTools(opts.handle),
    ...createPublicationTools(opts.handle),
    ...createDeleteTool(opts.handle),
    ...(opts.subagent ? createSubagentTools(opts.subagent) : []),
  ];
  const capability: AgentCapability = {
    systemSections: [
      coreRuntimeProtocolSection,
      novelIdentitySection,
      novelSystemSection,
      novelCraftSection,
      novelExecutionSection,
      toolGuidanceSection,
    ],
    toolDefs,
    nudgePolicies: [], // compose nudge 由 Conversation 层注入（依赖 ConversationContext）
    compactPolicies: [],
  };
  const dispatcher: ToolDispatcher = {
    dispatch: async (_ctx, call) => {
      const tool = toolDefs.find((t) => t.name === call.name);
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
  });
}
