/**
 * CCB 主 agent 参考 AgentDefinition（只读参考，不用于线上运行）。
 * CCB main-agent reference AgentDefinition (read-only reference, not for production).
 *
 * 用途 / Purpose：把 CCB 主 agent 的静态 System Prompt 段按原顺序组装成一份 Recipe，
 * 供 SystemPromptBuilder 对齐验证（ccb_main_reference 冒烟）。
 * Assembles CCB main-agent static system prompt sections in original order for
 * SystemPromptBuilder alignment validation (ccb_main_reference smoke).
 *
 * 说明 / Notes：
 * - Recipe 顺序与 CCB getSystemPrompt() 的静态段顺序一致：
 *   Recipe order matches CCB getSystemPrompt() static sections:
 *   Intro -> System -> Doing tasks -> Actions -> Using your tools -> Communication style。
 * - 本定义不包含 core.runtime.protocol / completion.contract，构建时需以
 *   requiredSectionIds: [] 调用 SystemPromptBuilder，否则会触发必选段校验失败。
 *   It omits core.runtime.protocol / completion.contract; build with
 *   requiredSectionIds: [] or the required-section validation fails.
 * - 只作研究参考，不注册进任何线上 Catalog 的默认可用集。
 *   Reference only; never registered in any production Catalog's default set.
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

/** 只读参考 agent 定义：按 CCB 静态段顺序组装主 agent prompt。Read-only reference definition for CCB main-agent prompt alignment. */
export const ccbMainReferenceAgentDefinition = new AgentDefinition({
  agentType: "ccb_main_reference",
  definitionVersion: "1.0.0",
  label: "CCB Main Reference",
  description:
    "Reference Agent that assembles the Claude Code main agent static system prompt verbatim for alignment research.",
  promptRecipe: new PromptRecipe([
    new PromptSectionItem("ccb.reference.intro"),
    new PromptSectionItem("ccb.reference.system"),
    new PromptSectionItem("ccb.reference.doing-tasks"),
    new PromptSectionItem("ccb.reference.actions"),
    new PromptSectionItem("ccb.reference.using-tools"),
    new PromptSectionItem("ccb.reference.communication-style"),
  ]),
  tools: new AgentToolPolicy({ groupIds: ["runtime.todo"] }),
  delegation: new AgentDelegationPolicy({
    mode: "disabled",
    allowedAgentTypes: [],
  }),
  communication: new AgentCommunicationPolicy("standalone"),
  runtimePolicyId: "default",
});
