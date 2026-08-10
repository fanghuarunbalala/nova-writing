/**
 * 独立 Novel Agent：通用协议段 + novel.* 创作段 + TodoWrite 与大纲等工具，
 * 可委托 novel_explorer / novel_compose 只读子代理。
 * Standalone Novel Agent with generic protocol sections, novel.* creative
 * sections, TodoWrite, outline tools, and delegation to the read-only
 * novel_explorer / novel_compose subagents.
 */
import {
  AgentCommunicationPolicy,
  AgentDefinition,
  AgentDelegationPolicy,
  AgentToolPolicy,
} from "../definition/AgentDefinition.js";
import {
  PromptRecipe,
  PromptSectionItem,
} from "../../prompt/index.js";

export const novelAgentDefinition = new AgentDefinition({
  agentType: "novel",
  definitionVersion: "1.5.0",
  label: "Novel Agent",
  description: "Collaborates with the user to imagine, plan, and create serialized web novels.",
  promptRecipe: new PromptRecipe([
    new PromptSectionItem("core.runtime.protocol"),
    new PromptSectionItem("novel.identity"),
    new PromptSectionItem("novel.system"),
    new PromptSectionItem("novel.doing-tasks"),
    new PromptSectionItem("novel.actions"),
    new PromptSectionItem("novel.communication"),
    new PromptSectionItem("core.environment"),
    new PromptSectionItem("novel.global_constraints"),
    // new PromptSectionItem("conversation.behavior"),
    // new PromptSectionItem("tool.guidance"),
    // new PromptSectionItem("todo.guidance"),
    // new PromptSectionItem("context.reliability"),
    // new PromptSectionItem("completion.contract"),
  ]),
  tools: new AgentToolPolicy({
    groupIds: [
      "runtime.todo",
      "runtime.files",
      "novel.compose",
      "runtime.subagent",
      "novel.outline",
      "novel.characters",
      "novel.locations",
      "novel.paragraph",
      "novel.publication",
      "novel.delete",
    ],
  }),
  delegation: new AgentDelegationPolicy({
    mode: "subagent",
    allowedAgentTypes: ["novel_explorer", "novel_compose"],
  }),
  communication: new AgentCommunicationPolicy("standalone"),
  runtimePolicyId: "default",
  /** Novel agent 显式启用的 nudge（nudgeId）；装配侧 ∩ 工具组守卫后注入。 */
  nudgeEnablement: Object.freeze({
    enabled: Object.freeze([
      "novel.reminder.compose_mode",
      "novel.reminder.compose_mode_pending",
      "novel.reminder.compose_mode_reentry",
      "novel.reminder.compose_mode_exit",
      "novel.reminder.compose_mode_sparse",
      "novel.reminder.todo_idle",
    ]),
  }),
});
