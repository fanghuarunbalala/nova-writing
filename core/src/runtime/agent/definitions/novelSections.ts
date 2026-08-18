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
  toolPolicySection,
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
  novelComposeGuideSection,
  novelBookAnalystIdentitySection,
  novelBookAnalystProcessSection,
  novelBookAnalystArtifactsSection,
} from "../../prompt/sections/novel.js";
import {
  novelStoryAppealSection,
  novelOutlineStandardSection,
  novelProseStandardSection,
  novelPublicationStandardSection,
} from "../../prompt/sections/novelStandards.js";

/** novel 域段注册表（id@version；25 段：main 9 + 共享 3 + 标准 4 + explorer 1 + compose 5 + book-analyst 3） */
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
  toolPolicySection,
  toolGuidanceSection,
  // subagent 共享段（explorer/compose recipe 引用）
  contextReliabilitySection,
  completionContractSection,
  todoGuidanceSection,
  // 质量标准段（规范层：main 与 compose recipe 引用，按名被 project_stage nudge 引用）
  novelStoryAppealSection,
  novelOutlineStandardSection,
  novelProseStandardSection,
  novelPublicationStandardSection,
  // explorer 专属段
  novelExplorerSection,
  // compose 专属段（legacy 迁移 + guide 动态段：PRD compose-案例引导）
  novelComposeIdentitySection,
  novelComposeSystemSection,
  novelComposeProcessSection,
  novelComposeReportingSection,
  novelComposeGuideSection,
  // BookAnalyst 专属段（书库完本解构，PRD library-完本解构 F4）
  novelBookAnalystIdentitySection,
  novelBookAnalystProcessSection,
  novelBookAnalystArtifactsSection,
]);
