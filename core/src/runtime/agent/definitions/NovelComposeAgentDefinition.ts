/**
 * 草案创作者子代理声明式定义（Compose，从 legacy main 分支迁移）：
 * 在主创作代理委托下把创作需求转化为可直接应用的大纲与行文设计草案——只读
 * 探索、产出草案文本，不落库。工具边界与 explorer 同构（groupIds + allow
 * 正向钉死），差异在 prompt（identity/system/process/reporting 四段）。
 * Draft-creator subagent definition (ported from legacy main): read-only
 * exploration producing outline and prose design proposals without persisting.
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

/** 精确只读工具名单（与 explorer 一致：文件读 + NovelRead（kind 分发六域）+ TodoWrite） */
export const NOVEL_COMPOSE_TOOL_NAMES: readonly string[] = Object.freeze([
  "Read",
  "Glob",
  "NovelRead",
  "TodoWrite",
]);

/**
 * Compose 声明式定义（label/description 供 Agent 工具描述渲染——中文）。
 * recipe 序（explorer 框架 + legacy compose 四段 + 三质量规范段）：
 * protocol → context.reliability → completion.contract → todo.guidance →
 * novel.compose.identity → novel.compose.system → novel.compose.process →
 * novel.compose.reporting → novel.story_appeal → novel.outline_standard →
 * novel.prose_standard → tool.policy(dynamic) → tool.guidance(dynamic 收尾) →
 * memory.index(dynamic，PRD memory-两层记忆 D8：提供者按 author/feedback 过滤)。
 * 案例索引不住独立段：质量规范段尾「参考案例」小节承载（PRD compose-案例引导 v0.6）。
 */
export const novelComposeAgentDefinition = new AgentDefinition({
  agentType: "Compose",
  definitionVersion: "1.4.0",
  label: "草案创作",
  description:
    "基于当前故事状态起草大纲与行文设计方案，返回主代理可直接应用的草案文本（只读，不落库）。",
  promptRecipe: new PromptRecipe([
    new PromptSectionItem("core.runtime.protocol"),
    new PromptSectionItem("context.reliability"),
    new PromptSectionItem("completion.contract"),
    new PromptSectionItem("todo.guidance"),
    new PromptSectionItem("novel.compose.identity"),
    new PromptSectionItem("novel.compose.system"),
    new PromptSectionItem("novel.compose.process"),
    new PromptSectionItem("novel.compose.reporting"),
    new PromptSectionItem("novel.story_appeal"),
    new PromptSectionItem("novel.outline_standard"),
    new PromptSectionItem("novel.prose_standard"),
    new PromptSectionItem("tool.policy"),
    new PromptSectionItem("tool.guidance"),
    new PromptSectionItem("memory.index"),
  ]),
  tools: new AgentToolPolicy({
    groupIds: ["runtime.files", "novel.entities", "runtime.todo"],
    allow: [...NOVEL_COMPOSE_TOOL_NAMES],
  }),
  delegation: new AgentDelegationPolicy({ mode: "disabled", allowedAgentTypes: [] }),
  communication: new AgentCommunicationPolicy("ephemeral_subagent"),
  runtimePolicyId: "default",
});
