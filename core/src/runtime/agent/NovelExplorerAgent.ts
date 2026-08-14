/**
 * novel_explorer 装配：进程内只读探索子代理（8 个只读工具 + 6 段 system prompt）。
 * 对齐 architecture.md subagent 概念：无独立进程/持久化，事件 live 进 hub（agentId 盖章）。
 */
import type { Provider } from "../provider/Provider.js";
import type { AgentCapability } from "./AgentCapability.js";
import type { ToolDef } from "../tool/ToolDef.js";
import type { SubagentCatalogEntry } from "../tool/definitions/subagent.js";
import { AgentLoop } from "../loop/AgentLoop.js";
import { InMemoryToolRegistry } from "../tool/InMemoryToolRegistry.js";
import { createToolDispatcher } from "../tool/createToolDispatcher.js";
import { applyToolPolicy } from "../tool/toolPolicy.js";
import { createFileTools } from "../tool/definitions/files.js";
import {
  createCharacterTools,
  createLocationTools,
  createOutlineTools,
  createParagraphTools,
  createPublicationTools,
} from "../tool/definitions/novel.js";
import { createTodoWriteTool } from "../tool/definitions/todo.js";
import {
  coreRuntimeProtocolSection,
  completionContractSection,
  contextReliabilitySection,
  todoGuidanceSection,
  toolGuidanceSection,
} from "../prompt/sections/agent.js";
import { novelExplorerSection } from "../prompt/sections/novel.js";
import type { NovelHandle } from "../../novel/client/NovelHandle.js";
import type { ConversationTodoStore } from "../todo/TodoProtocol.js";

/** novel_explorer agent 类型 */
export const NOVEL_EXPLORER_AGENT_TYPE = "novel_explorer";

/** 精确只读工具名单（钉死只读边界：无 Write/Edit/Delete/Agent） */
export const NOVEL_EXPLORER_TOOL_NAMES: readonly string[] = [
  "Read",
  "Glob",
  "CharacterRead",
  "LocationRead",
  "OutlineRead",
  "ParagraphRead",
  "PublicationRead",
  "TodoWrite",
];

/**
 * novel_explorer 目录条目（SubagentCatalogEntry：Agent 工具描述渲染所需展示字段）。
 * label/description 对齐旧 ProductionSubagentComposition 文案；tools.allow 钉死只读边界
 * （策略为唯一事实源，装配经 applyToolPolicy 过滤全池）。
 * 与 AgentDefinition 值对象解耦：subagent 装配不在本期 AgentAssembler 范围
 * （详见 tool/definitions/subagent.ts 的 SubagentCatalogEntry 说明）。
 */
export const NOVEL_EXPLORER_DEFINITION: SubagentCatalogEntry = {
  agentType: NOVEL_EXPLORER_AGENT_TYPE,
  label: "只读探索",
  description: "读取大纲、人物、地点、段落、卷与章节，返回简洁的文本性发现。",
  tools: { allow: [...NOVEL_EXPLORER_TOOL_NAMES] },
};

/** 可派生子代理定义目录（Agent 工具描述渲染来源；当前仅 novel_explorer） */
export const NOVEL_SUBAGENT_DEFINITIONS: readonly SubagentCatalogEntry[] = [NOVEL_EXPLORER_DEFINITION];

/** 可派生子代理类型白名单（旧 SubagentToolCompositionPolicy.allowedAgentTypes 等价物） */
export const NOVEL_SUBAGENT_ALLOWED_TYPES: readonly string[] = [NOVEL_EXPLORER_AGENT_TYPE];

/** novel_explorer 装配选项 */
export interface NovelExplorerAgentOptions {
  /** 工作区路径（Read/Glob 沙盒） */
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
}

/**
 * 装配 novel_explorer 子代理 loop（只读工具子集 + explorer 专属 prompt 分段）
 * @param opts 装配选项
 * @returns AgentLoop（config 带 conversationId + agentId，无 listeners——live-only）
 */
export function buildNovelExplorerAgent(opts: NovelExplorerAgentOptions): AgentLoop {
  // 全池装配（含写工具）→ NOVEL_EXPLORER_DEFINITION.tools 策略过滤钉死只读边界
  const pool: ToolDef[] = [
    ...createFileTools(opts.workspace),
    ...createCharacterTools(opts.handle),
    ...createLocationTools(opts.handle),
    ...createOutlineTools(opts.handle),
    ...createParagraphTools(opts.handle),
    ...createPublicationTools(opts.handle),
    createTodoWriteTool(opts.todoStore, opts.conversationId),
  ];
  const toolDefs = applyToolPolicy(pool, NOVEL_EXPLORER_DEFINITION.tools);
  const registry = new InMemoryToolRegistry();
  for (const def of toolDefs) registry.register(def);
  const capability: AgentCapability = {
    systemSections: [
      coreRuntimeProtocolSection,
      contextReliabilitySection,
      completionContractSection,
      todoGuidanceSection,
      novelExplorerSection,
      toolGuidanceSection,
    ],
    toolDefs,
    nudgePolicies: [],
    compactPolicies: [],
  };
  // live-only：不传 listeners（subagent 事件只进 hub，不落 journal）
  return new AgentLoop({
    workspace: opts.workspace,
    provider: opts.provider,
    agentCapability: capability,
    toolDispatcher: createToolDispatcher(registry),
    conversationId: opts.conversationId,
    agentId: opts.agentId,
  });
}
