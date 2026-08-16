/**
 * 草案创作者子代理声明式定义（novel_compose，从 legacy main 分支迁移）：
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

/** 精确只读工具名单（与 explorer 一致：文件读 + novel 各域读 + TodoWrite） */
export const NOVEL_COMPOSE_TOOL_NAMES: readonly string[] = Object.freeze([
  "Read",
  "Glob",
  "NovelCharacterRead",
  "NovelLocationRead",
  "NovelOutlineRead",
  "NovelParagraphRead",
  "NovelVolumeRead",
  "NovelChapterRead",
  "TodoWrite",
]);

/**
 * novel_compose 声明式定义（label/description 供 Agent 工具描述渲染——中文）。
 * recipe 序（explorer 框架 + legacy compose 四段）：
 * protocol → context.reliability → completion.contract → todo.guidance →
 * novel.compose.identity → novel.compose.system → novel.compose.process →
 * novel.compose.reporting → tool.policy(dynamic) → tool.guidance(dynamic 收尾)。
 */
export const novelComposeAgentDefinition = new AgentDefinition({
  agentType: "novel_compose",
  definitionVersion: "1.0.0",
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
    new PromptSectionItem("tool.policy"),
    new PromptSectionItem("tool.guidance"),
  ]),
  tools: new AgentToolPolicy({
    groupIds: [
      "runtime.files",
      "novel.characters",
      "novel.locations",
      "novel.outline",
      "novel.paragraph",
      "novel.volumes",
      "novel.chapters",
      "runtime.todo",
    ],
    allow: [...NOVEL_COMPOSE_TOOL_NAMES],
  }),
  delegation: new AgentDelegationPolicy({ mode: "disabled", allowedAgentTypes: [] }),
  communication: new AgentCommunicationPolicy("ephemeral_subagent"),
  runtimePolicyId: "default",
});
