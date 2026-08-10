/**
 * 只读创作子代理：可读取大纲/角色/地点/段落/出版结构的 Read 工具 + TodoWrite，
 * 通过 deny 排除全部 Write/Edit/Delete 工具。产出大纲与行文设计方案文本，不做落库。
 * Read-only compose Subagent: the six novel Read tools plus TodoWrite, with all
 * Write/Edit/Delete tools denied. Produces outline and prose design text without
 * persisting to the canonical store.
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

/** 只读子代理允许的工具组（5 个读组 + 待办）。Read-only allowed tool groups. */
const NOVEL_COMPOSE_TOOL_GROUPS = Object.freeze([
  "runtime.todo",
  "novel.outline",
  "novel.characters",
  "novel.locations",
  "novel.paragraph",
  "novel.publication",
]);

/** 被拒绝的写/编辑/删除工具（必须存在于注册表）。Denied mutation tools. */
const NOVEL_COMPOSE_DENIED_TOOLS = Object.freeze([
  "NovelOutlineWrite",
  "NovelOutlineEdit",
  "NovelCharacterWrite",
  "NovelCharacterEdit",
  "NovelLocationWrite",
  "NovelLocationEdit",
  "NovelParagraphWrite",
  "NovelParagraphEdit",
  "NovelVolumeWrite",
  "NovelVolumeEdit",
  "NovelChapterWrite",
  "NovelChapterEdit",
  "NovelDelete",
]);

export const novelComposeAgentDefinition = new AgentDefinition({
  agentType: "novel_compose",
  definitionVersion: "1.0.0",
  label: "Novel Compose",
  description:
    "Read-only Novel subagent that drafts outline and prose design proposals from the current story state, returning text the parent agent can apply.",
  promptRecipe: new PromptRecipe([
    new PromptSectionItem("core.runtime.protocol"),
    new PromptSectionItem("novel.compose.identity"),
    new PromptSectionItem("novel.compose.system"),
    new PromptSectionItem("novel.compose.process"),
    new PromptSectionItem("novel.compose.reporting"),
    new PromptSectionItem("core.environment"),
  ]),
  tools: new AgentToolPolicy({
    groupIds: NOVEL_COMPOSE_TOOL_GROUPS,
    deny: NOVEL_COMPOSE_DENIED_TOOLS,
  }),
  delegation: new AgentDelegationPolicy({
    mode: "disabled",
    allowedAgentTypes: [],
  }),
  communication: new AgentCommunicationPolicy("ephemeral_subagent"),
  runtimePolicyId: "default",
});
