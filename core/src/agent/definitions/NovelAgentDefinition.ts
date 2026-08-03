/** Initial standalone Novel Agent using only generic Prompt Sections and TodoWrite. */
import {
  AgentCommunicationPolicy,
  AgentDefinition,
  AgentDelegationPolicy,
  AgentToolPolicy,
} from "../definition/AgentDefinition.js";
import {
  InlinePromptItem,
  PromptRecipe,
  PromptSectionItem,
} from "../../prompt/index.js";

export const novelAgentDefinition = new AgentDefinition({
  agentType: "novel_agent",
  definitionVersion: "1.0.0",
  label: "Novel Agent",
  description: "Collaborates with the user to imagine, plan, and create serialized web novels.",
  promptRecipe: new PromptRecipe([
    new PromptSectionItem("core.runtime.protocol"),
    new PromptSectionItem("agent.identity"),
    new PromptSectionItem("conversation.behavior"),
    new InlinePromptItem("Respond in the language currently used by the user."),
    new PromptSectionItem("tool.guidance"),
    new PromptSectionItem("todo.guidance"),
    new PromptSectionItem("context.reliability"),
    new PromptSectionItem("completion.contract"),
  ]),
  tools: new AgentToolPolicy({ groupIds: ["runtime.todo"] }),
  delegation: new AgentDelegationPolicy({
    mode: "disabled",
    allowedAgentTypes: [],
  }),
  communication: new AgentCommunicationPolicy("standalone"),
  runtimePolicyId: "default",
});
