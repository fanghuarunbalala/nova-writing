/**
 * 独立 Novel Agent 声明式定义：通用协议段 + novel.* 创作段 + 文件与大纲等工具，
 * 可委托 Explore / Compose 只读子代理（delegation.allowedAgentTypes
 * 驱动 Agent 工具白名单，见 NovelAgent.ts 装配）。
 * Standalone Novel Agent declarative definition with generic protocol sections,
 * novel.* creative sections, file tools, outline tools, and delegation to the
 * read-only Explore / Compose subagents (delegation.allowedAgentTypes
 * drives the Agent tool whitelist; see assembly in NovelAgent.ts).
 *
 * recipe 序（static 全前、dynamic 后）：
 * novel.identity → novel.system → novel.doing-tasks → novel.actions →
 * novel.communication → novel.story_appeal → novel.outline_standard →
 * novel.prose_standard → core.runtime.protocol → tool.policy(dynamic) →
 * tool.guidance(dynamic) → core.environment(dynamic) →
 * novel.global_constraints(dynamic)
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

/** Novel Agent 声明式定义（definitionVersion 1.1.0：+三质量规范段） */
export const novelAgentDefinition = new AgentDefinition({
  agentType: "novel",
  definitionVersion: "1.1.0",
  label: "Novel Agent",
  description: "Collaborates with the user to imagine, plan, and create serialized web novels.",
  promptRecipe: new PromptRecipe([
    new PromptSectionItem("novel.identity"),
    new PromptSectionItem("novel.system"),
    new PromptSectionItem("novel.doing-tasks"),
    new PromptSectionItem("novel.actions"),
    new PromptSectionItem("novel.communication"),
    new PromptSectionItem("novel.story_appeal"),
    new PromptSectionItem("novel.outline_standard"),
    new PromptSectionItem("novel.prose_standard"),
    new PromptSectionItem("core.runtime.protocol"),
    new PromptSectionItem("tool.policy"),
    new PromptSectionItem("tool.guidance"),
    new PromptSectionItem("core.environment"),
    new PromptSectionItem("novel.global_constraints"),
  ]),
  tools: new AgentToolPolicy({
    groupIds: [
      "runtime.todo",
      "runtime.files",
      "runtime.ask",
      "novel.compose",
      "novel.entities",
    ],
  }),
  delegation: new AgentDelegationPolicy({
    mode: "subagent",
    allowedAgentTypes: ["Explore", "Compose"],
  }),
  communication: new AgentCommunicationPolicy("standalone"),
  runtimePolicyId: "default",
  /** Novel agent 显式启用的 nudge（nudgeId）；装配侧 ∩ 实现目录后注入。 */
  nudgeEnablement: Object.freeze({
    enabled: Object.freeze(["compose_mode", "todo_idle", "project_stage"]),
  }),
});
