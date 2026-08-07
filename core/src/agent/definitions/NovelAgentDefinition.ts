/**
 * 独立 Novel Agent：通用协议段 + novel.* 创作段 + TodoWrite 与大纲等工具。
 * Standalone Novel Agent with generic protocol sections, novel.* creative
 * sections, TodoWrite, and outline tools.
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
  definitionVersion: "1.2.0",
  label: "Novel Agent",
  description: "Collaborates with the user to imagine, plan, and create serialized web novels.",
  promptRecipe: new PromptRecipe([
    new PromptSectionItem("core.runtime.protocol"),
    new PromptSectionItem("novel.identity"),
    new PromptSectionItem("novel.system"),
    new PromptSectionItem("core.environment"),
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
      "novel.outline",
      "novel.characters",
      "novel.locations",
      "novel.paragraph",
      "novel.publication",
      "novel.delete",
    ],
  }),
  delegation: new AgentDelegationPolicy({
    mode: "disabled",
    allowedAgentTypes: [],
  }),
  communication: new AgentCommunicationPolicy("standalone"),
  runtimePolicyId: "default",
});
