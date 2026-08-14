/**
 * 独立 Novel Agent 声明式定义：通用协议段 + novel.* 创作段 + 文件与大纲等工具，
 * 可委托 novel_explorer / novel_compose 只读子代理（声明保留，运行时零效果——subagent 装配不在本期）。
 * Standalone Novel Agent declarative definition with generic protocol sections,
 * novel.* creative sections, file tools, outline tools, and delegation to the
 * read-only novel_explorer / novel_compose subagents (declared only; no runtime
 * effect — subagent assembly is out of scope this phase).
 *
 * recipe 序（static 全前、dynamic 后）：
 * novel.identity → novel.system → novel.doing-tasks → novel.actions →
 * novel.communication → core.runtime.protocol → core.environment(dynamic) →
 * novel.global_constraints(dynamic) → tool.guidance(dynamic)
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
import { PromptSectionRegistry } from "../../prompt/PromptSectionRegistry.js";
import {
  coreEnvironmentSection,
  coreRuntimeProtocolSection,
  toolGuidanceSection,
} from "../../prompt/sections/agent.js";
import {
  novelIdentitySection,
  novelSystemSection,
  novelCraftSection,
  novelExecutionSection,
  novelCommunicationSection,
  novelGlobalConstraintsSection,
} from "../../prompt/sections/novel.js";

/** Novel Agent 段注册表（id@version；9 段） */
export const novelSectionRegistry = new PromptSectionRegistry([
  novelIdentitySection,
  novelSystemSection,
  novelCraftSection,
  novelExecutionSection,
  novelCommunicationSection,
  coreRuntimeProtocolSection,
  coreEnvironmentSection,
  novelGlobalConstraintsSection,
  toolGuidanceSection,
]);

/** Novel Agent 声明式定义（definitionVersion 1.0.0，新架构起版） */
export const novelAgentDefinition = new AgentDefinition({
  agentType: "novel",
  definitionVersion: "1.0.0",
  label: "Novel Agent",
  description: "Collaborates with the user to imagine, plan, and create serialized web novels.",
  promptRecipe: new PromptRecipe([
    new PromptSectionItem("novel.identity"),
    new PromptSectionItem("novel.system"),
    new PromptSectionItem("novel.doing-tasks"),
    new PromptSectionItem("novel.actions"),
    new PromptSectionItem("novel.communication"),
    new PromptSectionItem("core.runtime.protocol"),
    new PromptSectionItem("core.environment"),
    new PromptSectionItem("novel.global_constraints"),
    new PromptSectionItem("tool.guidance"),
  ]),
  tools: new AgentToolPolicy({
    groupIds: [
      "runtime.todo",
      "runtime.files",
      "novel.characters",
      "novel.locations",
      "novel.outline",
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
  /** Novel agent 显式启用的 nudge（nudgeId）；装配侧 ∩ 实现目录后注入。 */
  nudgeEnablement: Object.freeze({
    enabled: Object.freeze(["compose_mode", "todo_idle"]),
  }),
});
