/**
 * BookAnalyst 装配：声明式定义（definitions/BookAnalystAgentDefinition）经
 * AgentAssembler 解析为 AgentLoop（独立后台会话，非 subagent）。与主 Agent 的
 * 差异：文件沙盒=书库根（analyst.files 免审批四件套）、novel handle 指向该书
 * book.db（读写）、无 compose/ask/subagent 装配；会话层以 bypass 模式运行
 * （canonical Novel 写自动放行，全程零审批挂起——入口装配负责）。
 */
import type { Provider } from "../provider/Provider.js";
import { AgentLoop } from "../loop/AgentLoop.js";
import { AgentAssembler } from "./AgentAssembler.js";
import { MapToolDispatcher } from "../tool/MapToolDispatcher.js";
import { bookAnalystAgentDefinition } from "./definitions/BookAnalystAgentDefinition.js";
import { novelSectionRegistry } from "./definitions/novelSections.js";
import {
  NOVEL_TOOL_GROUP_CATALOG,
  createNovelToolGroupResolver,
} from "../tool/groups/NovelToolGroups.js";
import type { NovelHandle } from "../../novel/client/NovelHandle.js";
import type { NovelStore } from "../../novel/store.js";
import type { ConversationTodoStore } from "../todo/TodoProtocol.js";
import { InMemoryConversationTodoStore } from "../todo/InMemoryConversationTodoStore.js";
import type { ProviderCallDebugger } from "../debug/ProviderCallDebugger.js";
import type { Logger } from "../../log/Logger.js";
import type { LoopContextListener } from "../loop/types.js";
import type { LLMessage } from "../provider/types.js";
import { TodoIdleNudgePolicy } from "../nudge/definitions/todo.js";
import type { ContextNudgePolicy } from "../nudge/ContextNudgePolicy.js";

/** BookAnalyst agent 类型（入口 agentType 分发键） */
export const BOOK_ANALYST_AGENT_TYPE = bookAnalystAgentDefinition.agentType;

/** BookAnalyst 装配选项 */
export interface BookAnalystAgentOptions {
  /** 书库根（analyst.files 文件沙盒） */
  libraryRoot: string;
  /** Provider 实例 */
  provider: Provider;
  /** 该书 book.db store（读写实例；入口按任务载荷打开） */
  store: NovelStore;
  /** conversation id（事件/落盘盖章） */
  conversationId: string;
  /** Todo 存储（缺省进程内实例） */
  todoStore?: ConversationTodoStore;
  /** 状态变化监听器（journal 落盘由上层注入 journalListener） */
  listeners?: LoopContextListener[];
  /** 可恢复的 run 消息（journal 重放；缺省从空开始） */
  runMessages?: LLMessage[];
  /** run seq 起始值（journal 恢复） */
  resumeSeq?: number;
  /** 结构化日志 */
  logger?: Logger;
  /** ProviderCall 调试器（debug 模式注入） */
  debugger?: ProviderCallDebugger;
}

/**
 * 装配 BookAnalyst loop（独立后台会话）
 * @param opts 装配选项（书库根 + provider +该书 store）
 * @returns AgentLoop（agentId="main"，journal listeners 可选注入）
 */
export function buildBookAnalystAgent(opts: BookAnalystAgentOptions): AgentLoop {
  const todoStore = opts.todoStore ?? new InMemoryConversationTodoStore();
  const handle: NovelHandle = {
    query: (q) => opts.store.query(q),
    mutate: (m) => opts.store.mutate(m),
    mutateBatch: (ms) => opts.store.mutateBatch(ms),
  } as NovelHandle;
  const nudgeCatalog: ReadonlyMap<string, () => ContextNudgePolicy> = new Map([
    ["todo_idle", () => new TodoIdleNudgePolicy()],
  ]);
  const assembler = new AgentAssembler({
    definition: bookAnalystAgentDefinition,
    sectionRegistry: novelSectionRegistry,
    toolGroupCatalog: NOVEL_TOOL_GROUP_CATALOG,
    resolveToolGroup: createNovelToolGroupResolver({
      workspace: opts.libraryRoot,
      handle,
      todoStore,
      todoConversationId: opts.conversationId,
      // 后台无人审批会话：novel.entities 写工具免审批（否则 NovelWrite/Edit/Delete
      // 被「审批通道未装配」拒绝，大纲/人物/地点写不进 book.db，只能退化为 md 落盘）
      entityApproval: false,
    }),
    nudgeCatalog,
  });
  const capability = assembler.assemble();
  return new AgentLoop({
    workspace: opts.libraryRoot,
    provider: opts.provider,
    agentCapability: capability,
    toolDispatcher: new MapToolDispatcher(capability.toolDefs),
    agentId: "main",
    conversationId: opts.conversationId,
    listeners: opts.listeners,
    runMessages: opts.runMessages,
    startSeq: opts.resumeSeq,
    logger: opts.logger,
    debugger: opts.debugger,
  });
}
