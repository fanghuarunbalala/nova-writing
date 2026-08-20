/**
 * ProjectImporter 独立后台 Agent 声明式定义（欢迎页「从文件导入创建项目」）：
 * 导入解构分析师——复用 novel 主 Agent 的装配机制（buildNovelAgent 的 definition
 * 注入 + 同一 sectionRegistry / 工具组目录），仅替换 prompt 段与裁剪工具面。
 * 与书库 BookAnalyst 区分：本 agent 写**当前项目** novel.db（大纲/人物/地点），
 * 通读工作区 `.novel/import/` 拆分产物；卷/章/段落与正文由宿主确定性导入，
 * 本 agent 一律只读（入口另有 mutation op 级守卫双保险）。
 * 工具组 = novel 主 Agent 的后台子集：runtime.todo（推进计划）+ runtime.files
 * （沙盒=工作区根，读写 import.json 收尾翻转）+ novel.entities（大纲/人物/地点写）。
 * 裁掉 runtime.ask（后台无人应答会挂起）与 novel.compose（写作态工具与解构无关）。
 * recipe 序（static 全前、dynamic 后）：
 * novel.project-importer.identity → novel.project-importer.process →
 * core.runtime.protocol → completion.contract → todo.guidance →
 * tool.policy(dynamic) → tool.guidance(dynamic 收尾)。
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

/** ProjectImporter 声明式定义（definitionVersion 1.0.0） */
export const projectImporterAgentDefinition = new AgentDefinition({
  agentType: "ProjectImporter",
  definitionVersion: "1.0.0",
  label: "导入解构分析师",
  description:
    "后台通读刚导入本项目的既有书稿，逆向构建大纲（幕/场景）、人物与地点档案；不改动卷章与正文。",
  promptRecipe: new PromptRecipe([
    new PromptSectionItem("novel.project-importer.identity"),
    new PromptSectionItem("novel.project-importer.process"),
    new PromptSectionItem("core.runtime.protocol"),
    new PromptSectionItem("completion.contract"),
    new PromptSectionItem("todo.guidance"),
    new PromptSectionItem("tool.policy"),
    new PromptSectionItem("tool.guidance"),
  ]),
  tools: new AgentToolPolicy({
    groupIds: ["runtime.todo", "runtime.files", "novel.entities"],
  }),
  delegation: new AgentDelegationPolicy({ mode: "disabled", allowedAgentTypes: [] }),
  communication: new AgentCommunicationPolicy("standalone"),
  runtimePolicyId: "default",
  /** todo_idle：长任务进度习惯（无 compose_mode——不适用） */
  nudgeEnablement: Object.freeze({
    enabled: Object.freeze(["todo_idle"]),
  }),
});

/** ProjectImporter agent 类型（入口 agentType 分发键 / spawn 指派） */
export const PROJECT_IMPORTER_AGENT_TYPE = projectImporterAgentDefinition.agentType;
