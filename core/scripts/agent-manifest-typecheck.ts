/** Compile-time examples for immutable Agent Manifest assembly and lookup. */
import {
  AgentAssembler,
  AgentManifest,
  AgentManifestResolver,
  AgentManifestStore,
  InMemoryAgentManifestStore,
  ResolvedPromptRecipe,
  ResolvedPromptSectionItem,
} from "../src/index.js";

const recipe = new ResolvedPromptRecipe([
  new ResolvedPromptSectionItem({
    sectionId: "core.runtime.protocol",
    version: "1.0.0",
  }),
]);

const store: AgentManifestStore = new InMemoryAgentManifestStore();
const resolver: AgentManifestResolver = undefined as never;
const assembler: AgentAssembler = undefined as never;
const manifest: AgentManifest = undefined as never;

// @ts-expect-error Manifest Prompt Recipes are immutable.
recipe.items.push(recipe.items[0]!);
// @ts-expect-error Manifest Store has no synchronous lookup surface.
store.getSync("manifest");

void resolver;
void assembler;
void manifest;
