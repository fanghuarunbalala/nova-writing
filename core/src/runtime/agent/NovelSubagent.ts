/**
 * novel 域 subagent 共享装配：声明式定义（definitions/）+ 段注册表 + 工具组目录
 * 经 AgentAssembler 解析为 AgentLoop。live-only：不传 listeners（subagent 事件
 * 只进 hub 按 agentId 盖章，不落 journal）。对齐 architecture.md subagent 概念。
 */
import type { Provider } from "../provider/Provider.js";
import type { AgentDefinition } from "./AgentDefinition.js";
import { AgentLoop } from "../loop/AgentLoop.js";
import { AgentAssembler } from "./AgentAssembler.js";
import { MapToolDispatcher } from "../tool/MapToolDispatcher.js";
import { novelSectionRegistry } from "./definitions/novelSections.js";
import {
  NOVEL_TOOL_GROUP_CATALOG,
  createNovelToolGroupResolver,
} from "../tool/groups/NovelToolGroups.js";
import type { NovelHandle } from "../../novel/client/NovelHandle.js";
import type { ConversationTodoStore } from "../todo/TodoProtocol.js";
import type { ProviderCallDebugger } from "../debug/ProviderCallDebugger.js";

/** novel 域 subagent 装配选项（explorer/compose 同构） */
export interface NovelSubagentOptions {
  /** 工作区路径（文件工具沙盒） */
  workspace: string;
  /** Provider 实例（每任务 fresh：runtime builder 内新建，不可跨 loop 共享） */
  provider: Provider;
  /** novel 客户端（只读查询） */
  handle: NovelHandle;
  /** 会话 todo 存储（TodoWrite 工具闭包） */
  todoStore: ConversationTodoStore;
  /** conversation id（事件盖章） */
  conversationId: string;
  /** agent id（事件盖章；runtime 传 <agentType>:<taskId>，非 "main"） */
  agentId: string;
  /** ProviderCall 调试器（debug 模式注入；runtime builder 每任务新建，输出目录按 agentId 区分） */
  debugger?: ProviderCallDebugger;
}

/** buildNovelSubagent 选项 = 公共装配依赖 + 目标定义 */
export interface BuildNovelSubagentOptions extends NovelSubagentOptions {
  /** subagent 声明式定义（novel_explorer / novel_compose） */
  definition: AgentDefinition;
}

/**
 * 装配 novel 域 subagent loop（与 main 同一条 declarative 路线）
 * @param opts 装配选项（含目标定义）
 * @returns AgentLoop（config 带 conversationId + agentId，无 listeners——live-only）
 */
export function buildNovelSubagent(opts: BuildNovelSubagentOptions): AgentLoop {
  const assembler = new AgentAssembler({
    definition: opts.definition,
    sectionRegistry: novelSectionRegistry,
    toolGroupCatalog: NOVEL_TOOL_GROUP_CATALOG,
    resolveToolGroup: createNovelToolGroupResolver({
      workspace: opts.workspace,
      handle: opts.handle,
      todoStore: opts.todoStore,
      todoConversationId: opts.conversationId,
    }),
  });
  const capability = assembler.assemble();
  return new AgentLoop({
    workspace: opts.workspace,
    provider: opts.provider,
    agentCapability: capability,
    toolDispatcher: new MapToolDispatcher(capability.toolDefs),
    conversationId: opts.conversationId,
    agentId: opts.agentId,
    debugger: opts.debugger,
  });
}
