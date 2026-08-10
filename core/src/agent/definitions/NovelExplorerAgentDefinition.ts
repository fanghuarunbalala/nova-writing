/**
 * 只读探索子代理：可读取大纲/角色/地点/段落/出版结构的 Read 工具 + TodoWrite，
 * 通过 deny 排除全部 Write/Edit/Delete 工具。不可再嵌套子代理。
 * Read-only explore Subagent: the six novel Read tools plus TodoWrite, with all
 * Write/Edit/Delete tools denied. Cannot nest further subagents.
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
const NOVEL_EXPLORER_TOOL_GROUPS = Object.freeze([
  "runtime.todo",
  "novel.outline",
  "novel.characters",
  "novel.locations",
  "novel.paragraph",
  "novel.publication",
]);

/** 被拒绝的写/编辑/删除工具（必须存在于注册表）。Denied mutation tools. */
const NOVEL_EXPLORER_DENIED_TOOLS = Object.freeze([
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

export const novelExplorerAgentDefinition = new AgentDefinition({
  agentType: "novel_explorer",
  definitionVersion: "1.0.0",
  label: "Novel Explorer",
  description:
    "Read-only Novel subagent that surveys the outline, characters, locations, paragraphs, volumes, and chapters to produce concise textual findings.",
  promptRecipe: new PromptRecipe([
    new PromptSectionItem("core.runtime.protocol"),
    new PromptSectionItem("novel.explore.identity"),
    new PromptSectionItem("novel.explore.system"),
    new PromptSectionItem("novel.explore.reporting"),
    new PromptSectionItem("core.environment"),
  ]),
  tools: new AgentToolPolicy({
    groupIds: NOVEL_EXPLORER_TOOL_GROUPS,
    deny: NOVEL_EXPLORER_DENIED_TOOLS,
  }),
  delegation: new AgentDelegationPolicy({
    mode: "disabled",
    allowedAgentTypes: [],
  }),
  communication: new AgentCommunicationPolicy("ephemeral_subagent"),
  runtimePolicyId: "default",
});
