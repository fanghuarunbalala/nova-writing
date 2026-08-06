/** Deterministically compiles an Agent Prompt Recipe without reading Runtime state. */
import { noopLogger, type Logger } from "../observability/index.js";
import type { AgentDefinition } from "../agent/definition/AgentDefinition.js";
import { CompiledSystemPrompt } from "./CompiledSystemPrompt.js";
import { PromptBlock } from "./PromptBlock.js";
import type { PromptCapabilitySnapshot } from "./PromptCapabilitySnapshot.js";
import { PromptContext } from "./PromptContext.js";
import type { PromptDigester } from "./PromptDigester.js";
import {
  InlinePromptItem,
  PromptSectionItem,
} from "./PromptPlanItem.js";
import type { PromptSectionRegistry } from "./section/PromptSectionRegistry.js";

export interface SystemPromptBuilderOptions {
  readonly sections: PromptSectionRegistry;
  readonly digester: PromptDigester;
  readonly requiredSectionIds?: readonly string[];
  readonly logger?: Logger;
}

export interface SystemPromptBuildRequest {
  readonly definition: AgentDefinition;
  readonly capabilities: PromptCapabilitySnapshot;
}

export class SystemPromptBuilder {
  readonly #sections: PromptSectionRegistry;
  readonly #digester: PromptDigester;
  readonly #requiredSectionIds: readonly string[];
  readonly #logger: Logger;

  constructor(options: SystemPromptBuilderOptions) {
    this.#sections = options.sections;
    this.#digester = options.digester;
    // 暂时不默认必选任何段：必选段校验机制后续再确定。
    // Temporarily no default required sections; the required-section validation
    // mechanism will be decided later.
    this.#requiredSectionIds = Object.freeze([
      ...(options.requiredSectionIds ?? []),
    ]);
    this.#logger = (options.logger ?? noopLogger).child({
      component: "system_prompt_builder",
    });
  }

  async build(request: SystemPromptBuildRequest): Promise<CompiledSystemPrompt> {
    const definition = request.definition;
    const context = new PromptContext({
      definition,
      capabilities: request.capabilities,
    });
    this.#assertRequiredSections(definition);
    this.#logger.debug("prompt.build_started", {
      agentType: definition.agentType,
      definitionVersion: definition.definitionVersion,
      promptItemCount: definition.promptRecipe.items.length,
    });

    const blocks: PromptBlock[] = [];
    for (const [index, item] of definition.promptRecipe.items.entries()) {
      if (item instanceof PromptSectionItem) {
        const section = this.#sections.resolve(
          item.sectionId,
          item.requestedVersion,
        );
        const content = requireRenderedContent(section.render(context));
        blocks.push(new PromptBlock({
          sourceKind: "section",
          sourceId: section.id,
          sourceVersion: section.version,
          content,
          digest: await this.#digester.digest(content),
        }));
        continue;
      }
      if (item instanceof InlinePromptItem) {
        blocks.push(new PromptBlock({
          sourceKind: "inline",
          sourceId: `inline:${index + 1}`,
          content: item.content,
          digest: await this.#digester.digest(item.content),
        }));
        continue;
      }
      throw new TypeError("Prompt Recipe item is unsupported");
    }

    const content = blocks.map((block) => block.content).join("\n\n");
    const compiled = new CompiledSystemPrompt({
      agentType: definition.agentType,
      definitionVersion: definition.definitionVersion,
      blocks,
      content,
      digest: await this.#digester.digest(content),
    });
    this.#logger.info("prompt.build_completed", {
      agentType: compiled.agentType,
      definitionVersion: compiled.definitionVersion,
      promptBlockCount: compiled.blocks.length,
      promptDigest: compiled.digest,
    });
    return compiled;
  }

  #assertRequiredSections(definition: AgentDefinition): void {
    const selected = new Set(
      definition.promptRecipe.items
        .filter((item): item is PromptSectionItem => item instanceof PromptSectionItem)
        .map((item) => item.sectionId),
    );
    for (const sectionId of this.#requiredSectionIds) {
      if (!selected.has(sectionId)) {
        throw new TypeError(`Required Prompt Section is missing: ${sectionId}`);
      }
    }
  }
}

function requireRenderedContent(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError("Rendered Prompt Section content is invalid");
  }
  return value;
}
