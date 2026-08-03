/** Runtime-owned façade for assembling one immutable Provider-call Prompt candidate. */
import {
  PromptAssemblyBuilder,
  type PromptAssemblyBuildRequest,
} from "../../prompt/assembly/index.js";
import type { PromptAssembly } from "../../prompt/assembly/PromptAssembly.js";

export class RuntimePromptAssembler {
  readonly #builder: PromptAssemblyBuilder;

  constructor(builder: PromptAssemblyBuilder) {
    if (!(builder instanceof PromptAssemblyBuilder)) {
      throw new TypeError("Runtime Prompt Assembler builder is invalid");
    }
    this.#builder = builder;
  }

  assemble(request: PromptAssemblyBuildRequest): Promise<PromptAssembly> {
    return this.#builder.build(request);
  }
}
