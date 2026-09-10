/**
 * 只读探索子代理声明式定义（Explore）：进程内只读探索——读取工作区文件
 * 与 novel 各域档案，返回简洁的文本性发现。工具边界用 groupIds + allow 正向
 * 钉死（allow 名单项不在池内抛 TOOL_POLICY_INVALID，新写工具进组不会泄漏）。
 * Read-only explore subagent definition: workspace files plus novel-domain reads,
 * with the readonly boundary pinned positively via groupIds + allow.
 */
import {
  AgentCommunicationPolicy,
  AgentDefinition,
  AgentDelegationPolicy,
  AgentToolPolicy,
} from "../AgentDefinition.js";
import {
  PromptRecipe,
  PromptSectionItem,
} from "../../prompt/PromptRecipe.js";

/** 精确只读工具名单（allow 白名单：无文件/实体写入与 NovelWrite/NovelEdit/NovelDelete/Agent；序 = 池序） */
export const NOVEL_EXPLORER_TOOL_NAMES: readonly string[] = Object.freeze([
  "Read",
  "Glob",
  "NovelRead",
  "TodoWrite",
]);

/**
 * Explore 声明式定义（label/description 供 Agent 工具描述渲染——中文）。
 * recipe 序：protocol → context.reliability → completion.contract → todo.guidance
 * → novel.explorer → tool.policy(dynamic) → tool.guidance(dynamic 收尾)。
 */
export const novelExplorerAgentDefinition = new AgentDefinition({
  agentType: "Explore",
  definitionVersion: "1.0.0",
  label: "只读探索",
  description: "读取大纲、人物、地点、段落、卷与章节，返回简洁的文本性发现。",
  promptRecipe: new PromptRecipe([
    new PromptSectionItem("core.runtime.protocol"),
    new PromptSectionItem("context.reliability"),
    new PromptSectionItem("completion.contract"),
    new PromptSectionItem("todo.guidance"),
    new PromptSectionItem("novel.explorer"),
    new PromptSectionItem("tool.policy"),
    new PromptSectionItem("tool.guidance"),
  ]),
  tools: new AgentToolPolicy({
    // 组序决定池序（tool.guidance 段按池序列工具）；runtime.todo 收尾对齐旧装配序
    groupIds: ["runtime.files", "novel.entities", "runtime.todo"],
    allow: [...NOVEL_EXPLORER_TOOL_NAMES],
  }),
  delegation: new AgentDelegationPolicy({ mode: "disabled", allowedAgentTypes: [] }),
  communication: new AgentCommunicationPolicy("ephemeral_subagent"),
  runtimePolicyId: "default",
  /** max_turn：轮次预算两级提醒（子代理 20 轮耗尽 = 成果整个丢失，止损价值高） */
  nudgeEnablement: Object.freeze({
    enabled: Object.freeze(["max_turn"]),
  }),
});
