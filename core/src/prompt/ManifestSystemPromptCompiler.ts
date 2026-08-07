/**
 * Manifest Prompt Compiler：编译静态 Prompt Section 为冻结的 base system prompt，
 * 存入 Agent Manifest。动态段由 RuntimeSystemPromptBuilder 每调用渲染。
 * Compiles static Prompt Sections into the frozen base system prompt recorded
 * in the Agent Manifest. Dynamic sections are rendered per call by
 * RuntimeSystemPromptBuilder.
 */
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

export interface ManifestSystemPromptCompilerOptions {
  readonly sections: PromptSectionRegistry;
  readonly digester: PromptDigester;
  readonly requiredSectionIds?: readonly string[];
  readonly logger?: Logger;
}

export interface ManifestSystemPromptCompileRequest {
  readonly definition: AgentDefinition;
  readonly capabilities: PromptCapabilitySnapshot;
}

export class ManifestSystemPromptCompiler {
  readonly #sections: PromptSectionRegistry;
  readonly #digester: PromptDigester;
  readonly #requiredSectionIds: readonly string[];
  readonly #logger: Logger;

  constructor(options: ManifestSystemPromptCompilerOptions) {
    this.#sections = options.sections;
    this.#digester = options.digester;
    // 暂时不默认必选任何段：必选段校验机制后续再确定。
    // Temporarily no default required sections; the required-section validation
    // mechanism will be decided later.
    this.#requiredSectionIds = Object.freeze([
      ...(options.requiredSectionIds ?? []),
    ]);
    this.#logger = (options.logger ?? noopLogger).child({
      component: "manifest_system_prompt_compiler",
    });
  }

  /** 编译使用的 section registry（供 recipe 解析动态段）。Section registry used for compilation (dynamic-section resolution). */
  get sections(): PromptSectionRegistry {
    return this.#sections;
  }

  /**
   * 编译静态段为 base prompt（一次）；动态段跳过，静态必须在动态之前。
   * Compiles static sections into the base prompt once; dynamic sections are
   * skipped, and static sections must precede dynamic ones.
   */
  async compile(
    request: ManifestSystemPromptCompileRequest,
  ): Promise<CompiledSystemPrompt> {
    const definition = request.definition;
    const context = new PromptContext({
      definition,
      capabilities: request.capabilities,
    });
    this.#assertRequiredSections(definition);
    this.#logger.debug("prompt.compile_started", {
      agentType: definition.agentType,
      definitionVersion: definition.definitionVersion,
      promptItemCount: definition.promptRecipe.items.length,
    });

    const blocks: PromptBlock[] = [];
    let sawDynamic = false;
    for (const [index, item] of definition.promptRecipe.items.entries()) {
      if (item instanceof PromptSectionItem) {
        const section = this.#sections.resolve(
          item.sectionId,
          item.requestedVersion,
        );
        if (section.kind === "dynamic") {
          sawDynamic = true;
          continue;
        }
        if (sawDynamic) {
          throw new TypeError(
            "Static Prompt Section must precede dynamic sections",
          );
        }
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
    this.#logger.info("prompt.compile_completed", {
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
