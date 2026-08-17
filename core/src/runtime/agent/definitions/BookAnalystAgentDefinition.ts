/**
 * BookAnalyst 独立后台 Agent 声明式定义（PRD library-完本解构 F4）：
 * 完本解构分析师——后台非交互会话，写书库（每书 book.db），不是 novel 主
 * Agent 的 subagent（不进 novelAgentDefinition.delegation.allowedAgentTypes）。
 * 工具面：analyst.files（免审批四件套，沙盒=书库根）+ novel.entities（写书库
 * 库：大纲 story_unit / 人物 / 地点 / 卷章；kind=paragraph 写不使用——正文
 * 不入库、分段由宿主文件化）+ runtime.todo（解析进度）。
 * recipe 序（static 全前、dynamic 后）：
 * novel.book-analyst.identity → novel.book-analyst.process →
 * novel.book-analyst.artifacts → core.runtime.protocol → completion.contract →
 * todo.guidance → tool.policy(dynamic) → tool.guidance(dynamic 收尾)。
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

/** BookAnalyst 声明式定义（definitionVersion 1.0.0） */
export const bookAnalystAgentDefinition = new AgentDefinition({
  agentType: "BookAnalyst",
  definitionVersion: "1.0.0",
  label: "完本解构分析师",
  description: "后台解构书库中一本已完本的书：生成大纲幕级单元、人物/地点卡，维护风格 md 与特色摘录。",
  promptRecipe: new PromptRecipe([
    new PromptSectionItem("novel.book-analyst.identity"),
    new PromptSectionItem("novel.book-analyst.process"),
    new PromptSectionItem("novel.book-analyst.artifacts"),
    new PromptSectionItem("core.runtime.protocol"),
    new PromptSectionItem("completion.contract"),
    new PromptSectionItem("todo.guidance"),
    new PromptSectionItem("tool.policy"),
    new PromptSectionItem("tool.guidance"),
  ]),
  tools: new AgentToolPolicy({
    groupIds: ["analyst.files", "novel.entities", "runtime.todo"],
  }),
  delegation: new AgentDelegationPolicy({ mode: "disabled", allowedAgentTypes: [] }),
  communication: new AgentCommunicationPolicy("standalone"),
  runtimePolicyId: "default",
  /** todo_idle：长任务进度习惯（无 compose_mode——不适用） */
  nudgeEnablement: Object.freeze({
    enabled: Object.freeze(["todo_idle"]),
  }),
});
