/**
 * novel 域单一段注册表：main / explorer / compose 三个 AgentDefinition 共用的
 * 全段目录（id@version 唯一）；各 definition 的 promptRecipe 按需引用子集。
 * Novel agent section registry: single catalog shared by the main / explorer /
 * compose definitions; each recipe references its own subset.
 */
import { PromptSectionRegistry } from "../../prompt/PromptSectionRegistry.js";
import {
  coreEnvironmentSection,
  coreRuntimeProtocolSection,
  completionContractSection,
  contextReliabilitySection,
  todoGuidanceSection,
  toolGuidanceSection,
} from "../../prompt/sections/agent.js";
import {
  novelIdentitySection,
  novelSystemSection,
  novelCraftSection,
  novelExecutionSection,
  novelCommunicationSection,
  novelGlobalConstraintsSection,
  novelExplorerSection,
  novelComposeIdentitySection,
  novelComposeSystemSection,
  novelComposeProcessSection,
  novelComposeReportingSection,
} from "../../prompt/sections/novel.js";

/** novel 域段注册表（id@version；17 段：main 9 + 共享 3 + explorer 1 + compose 4） */
export const novelSectionRegistry = new PromptSectionRegistry([
  // main（novel）recipe 段
  novelIdentitySection,
  novelSystemSection,
  novelCraftSection,
  novelExecutionSection,
  novelCommunicationSection,
  coreRuntimeProtocolSection,
  coreEnvironmentSection,
  novelGlobalConstraintsSection,
  toolGuidanceSection,
  // subagent 共享段（explorer/compose recipe 引用）
  contextReliabilitySection,
  completionContractSection,
  todoGuidanceSection,
  // explorer 专属段
  novelExplorerSection,
  // compose 专属段（legacy 迁移）
  novelComposeIdentitySection,
  novelComposeSystemSection,
  novelComposeProcessSection,
  novelComposeReportingSection,
]);
