/**
 * 动态 Prompt Section 基类：内容由运行时每调用渲染，不进 manifest 编译产物。
 * Dynamic Prompt Section base: content is rendered per call by the runtime and
 * never enters the manifest-compiled base prompt.
 */
import type { PromptEnvironmentSnapshot } from "../environment/EnvironmentPromptOverlay.js";
import { PromptSection, type PromptSectionOptions } from "./PromptSection.js";

/**
 * 动态段渲染输入：目前只有环境快照（workdir/modelId），可扩展。
 * Dynamic section render input: currently just the environment snapshot
 * (workdir/modelId); extensible later.
 */
export interface DynamicPromptSectionInput {
  readonly environment?: PromptEnvironmentSnapshot;
}

export abstract class DynamicPromptSection extends PromptSection {
  constructor(options: Omit<PromptSectionOptions, "kind">) {
    super({ ...options, kind: "dynamic" });
  }

  /**
   * 运行时渲染动态内容；输入缺失或无需输出时返回空串。
   * Renders dynamic content per call; returns an empty string when the input
   * is absent or no output is needed.
   */
  abstract renderDynamic(input: DynamicPromptSectionInput): string;
}
