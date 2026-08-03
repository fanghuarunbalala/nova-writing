/** Immutable Base System Prompt compiled from one resolved Prompt Recipe. */
import { PromptBlock } from "./PromptBlock.js";
import {
  capturePromptDigest,
  type PromptDigest,
} from "./PromptDigester.js";

export interface CompiledSystemPromptOptions {
  readonly agentType: string;
  readonly definitionVersion: string;
  readonly blocks: readonly PromptBlock[];
  readonly content: string;
  readonly digest: PromptDigest;
}

export class CompiledSystemPrompt {
  readonly agentType: string;
  readonly definitionVersion: string;
  readonly blocks: readonly PromptBlock[];
  readonly content: string;
  readonly digest: PromptDigest;

  constructor(options: CompiledSystemPromptOptions) {
    this.agentType = requireNonBlank(options.agentType);
    this.definitionVersion = requireNonBlank(options.definitionVersion);
    if (!Array.isArray(options.blocks) || options.blocks.length === 0) {
      throw new TypeError("Compiled Prompt blocks are invalid");
    }
    this.blocks = Object.freeze(
      [...options.blocks].map((block) => {
        if (!(block instanceof PromptBlock)) {
          throw new TypeError("Compiled Prompt block is invalid");
        }
        return block;
      }),
    );
    this.content = requireNonBlank(options.content);
    this.digest = capturePromptDigest(options.digest);
    Object.freeze(this);
  }
}

function requireNonBlank(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError("Compiled Prompt identity is invalid");
  }
  return value;
}
