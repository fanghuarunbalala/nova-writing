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
  novelBookAnalystIdentitySection,
  novelBookAnalystProcessSection,
  novelBookAnalystArtifactsSection,
  novelProjectImporterIdentitySection,
  novelProjectImporterProcessSection,
} from "../../prompt/sections/novel.js";
import {
  novelStoryAppealSection,
  novelOutlineStandardSection,
  novelProseStandardSection,
  novelPublicationStandardSection,
} from "../../prompt/sections/novelStandards.js";
import { skillIndexSection } from "../../skill/skillIndexSection.js";

/** novel 域段注册表（id@version；27 段：main 10 + 共享 3 + 标准 4 + explorer 1 + compose 4 + book-analyst 3 + project-importer 2） */
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
  // 技能索引（skill.index，渐进披露第一层；快照由宿主装配期注入，main recipe 引用）
  skillIndexSection,
  // subagent 共享段（explorer/compose recipe 引用）
  contextReliabilitySection,
  completionContractSection,
  todoGuidanceSection,
  // 质量标准段（规范层：main 与 compose recipe 引用，按名被 project_stage nudge 引用；
  // 动态段——尾附按 task_type 前缀过滤的「参考案例」小节，索引经 caseGuide 快照注入）
  novelStoryAppealSection,
  novelOutlineStandardSection,
  novelProseStandardSection,
  novelPublicationStandardSection,
  // explorer 专属段
  novelExplorerSection,
  // compose 专属段（legacy 迁移；案例索引并入共享质量标准段，PRD compose-案例引导 v0.6）
  novelComposeIdentitySection,
  novelComposeSystemSection,
  novelComposeProcessSection,
  novelComposeReportingSection,
  // BookAnalyst 专属段（书库完本解构，PRD library-完本解构 F4）
  novelBookAnalystIdentitySection,
  novelBookAnalystProcessSection,
  novelBookAnalystArtifactsSection,
  // ProjectImporter 专属段（项目导入解构：欢迎页「从文件导入创建项目」）
  novelProjectImporterIdentitySection,
  novelProjectImporterProcessSection,
]);
