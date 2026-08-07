/**
 * 运行时 Prompt Builder：每调用把静态 base（manifest 编译缓存）与动态段渲染
 * 结果拼成最终 system prompt，并重算 digest。
 * Runtime prompt builder: composes the final system prompt per call from the
 * static base (manifest-compiled cache) plus rendered dynamic sections, and
 * recomputes the digest.
 */
import { noopLogger, type Logger } from "../../observability/index.js";
import type {
  DynamicPromptSection,
  DynamicPromptSectionInput,
  PromptBase,
  PromptDigester,
} from "../../prompt/index.js";
import type { RuntimeRunExecutionRequest } from "../execution/control/RuntimeUserMessageInputHandler.js";
import type { RuntimeBasePromptSource } from "../execution/agent/RuntimeSystemPromptSource.js";

export interface RuntimeSystemPromptBuilderOptions {
  /** 静态 base 源（manifest 编译产物）。Static base source (manifest-compiled prompt). */
  readonly staticSource: RuntimeBasePromptSource;
  /** 本 agent recipe 中的动态段（已解析）。Dynamic sections resolved from this agent's recipe. */
  readonly dynamicSections: readonly DynamicPromptSection[];
  /** 每调用动态段输入（如环境快照）。Per-call dynamic section input (e.g. environment). */
  readonly input: () => Promise<DynamicPromptSectionInput>;
  readonly digester: PromptDigester;
  readonly logger?: Logger;
}

export class RuntimeSystemPromptBuilder implements RuntimeBasePromptSource {
  readonly #staticSource: RuntimeBasePromptSource;
  readonly #dynamicSections: readonly DynamicPromptSection[];
  readonly #input: () => Promise<DynamicPromptSectionInput>;
  readonly #digester: PromptDigester;
  readonly #logger: Logger;

  constructor(options: RuntimeSystemPromptBuilderOptions) {
    this.#staticSource = options.staticSource;
    this.#dynamicSections = Object.freeze([...options.dynamicSections]);
    this.#input = options.input;
    this.#digester = options.digester;
    this.#logger = (options.logger ?? noopLogger).child({
      component: "runtime_system_prompt_builder",
    });
  }

  /** 每调用解析最终 system prompt：静态前缀 + 动态段。Resolves the final system prompt per call: static prefix plus dynamic sections. */
  async resolve(request: RuntimeRunExecutionRequest): Promise<PromptBase> {
    const base = await this.#staticSource.resolve(request);
    const input = await this.#input();
    const dynamicBlocks: string[] = [];
    for (const section of this.#dynamicSections) {
      const content = section.renderDynamic(input);
      if (content.trim().length > 0) {
        dynamicBlocks.push(content);
      }
    }
    const content =
      dynamicBlocks.length === 0
        ? base.content
        : `${base.content}\n\n${dynamicBlocks.join("\n\n")}`;
    const digest = await this.#digester.digest(content);
    this.#logger.debug("prompt.resolve_completed", {
      dynamicBlockCount: dynamicBlocks.length,
    });
    return { content, digest };
  }
}
