/** Immutable Context passed to reusable base Prompt sections. */
import type { AgentDefinition } from "../agent/definition/AgentDefinition.js";
import type { PromptCapabilitySnapshot } from "./PromptCapabilitySnapshot.js";

export interface PromptContextOptions {
  readonly definition: AgentDefinition;
  readonly capabilities: PromptCapabilitySnapshot;
}

export class PromptContext {
  readonly definition: AgentDefinition;
  readonly capabilities: PromptCapabilitySnapshot;

  constructor(options: PromptContextOptions) {
    this.definition = options.definition;
    this.capabilities = options.capabilities;
    Object.freeze(this);
  }
}
