/**
 * 默认 Prompt Section 注册表组装器：聚合 agent 层通用段 + novel 域段。
 * Default Prompt Section registry assembler: aggregates agent-layer generic
 * sections plus the novel-domain sections.
 */
import {
  PromptSectionRegistry,
  PromptSectionRegistryAssembler,
} from "../section/PromptSectionRegistry.js";
import {
  AgentIdentityPromptSection,
  CompletionContractPromptSection,
  ContextReliabilityPromptSection,
  ConversationBehaviorPromptSection,
  CoreEnvironmentPromptSection,
  CoreRuntimeProtocolPromptSection,
  TodoGuidancePromptSection,
  ToolGuidancePromptSection,
} from "./agent/index.js";
import {
  NovelActionsPromptSection,
  NovelCommunicationPromptSection,
  NovelComposeIdentityPromptSection,
  NovelComposeProcessPromptSection,
  NovelComposeReportingPromptSection,
  NovelComposeSystemPromptSection,
  NovelDoingTasksPromptSection,
  NovelExploreIdentityPromptSection,
  NovelExploreReportingPromptSection,
  NovelExploreSystemPromptSection,
  NovelGlobalConstraintsPromptSection,
  NovelIdentityPromptSection,
  NovelSystemPromptSection,
} from "./novel/index.js";

export function createDefaultPromptSectionRegistry(): PromptSectionRegistry {
  return new PromptSectionRegistryAssembler()
    .register(new CoreRuntimeProtocolPromptSection())
    .register(new AgentIdentityPromptSection())
    .register(new ConversationBehaviorPromptSection())
    .register(new ToolGuidancePromptSection())
    .register(new TodoGuidancePromptSection())
    .register(new ContextReliabilityPromptSection())
    .register(new CompletionContractPromptSection())
    .register(new NovelIdentityPromptSection())
    .register(new NovelSystemPromptSection({ interactsWithUser: true }))
    .register(new NovelCommunicationPromptSection())
    .register(new NovelExploreIdentityPromptSection())
    .register(new NovelExploreSystemPromptSection())
    .register(new NovelExploreReportingPromptSection())
    .register(new NovelComposeIdentityPromptSection())
    .register(new NovelComposeSystemPromptSection())
    .register(new NovelComposeProcessPromptSection())
    .register(new NovelComposeReportingPromptSection())
    .register(new NovelDoingTasksPromptSection())
    .register(new NovelActionsPromptSection())
    .register(new CoreEnvironmentPromptSection())
    .register(new NovelGlobalConstraintsPromptSection())
    .freeze();
}
