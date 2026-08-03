/** Compile-time examples for class-based Prompt Recipe and novel_agent Definition. */
import {
  AgentDefinitionCatalog,
  PromptCapabilitySnapshot,
  PromptSection,
  PromptSectionRegistry,
  PromptSectionRegistryAssembler,
  SystemPromptBuilder,
  createDefaultPromptSectionRegistry,
  novelAgentDefinition,
} from "../src/index.js";

class ExampleSection extends PromptSection {
  constructor(version: string) {
    super({ id: "example.section", version, label: "Example" });
  }

  render(): string {
    return "example";
  }
}

const registry: PromptSectionRegistry = new PromptSectionRegistry([
  new ExampleSection("1.0.0"),
]);
const assembler = new PromptSectionRegistryAssembler();
assembler.register(new ExampleSection("1.1.0")).freeze();

const builder = new SystemPromptBuilder({
  sections: createDefaultPromptSectionRegistry(),
  digester: {
    algorithm: "sha256",
    async digest() {
      return `sha256:${"0".repeat(64)}`;
    },
  },
});
const capabilities = new PromptCapabilitySnapshot([
  {
    name: "TodoWrite",
    version: "1.0.0",
    label: "Todo Write",
    description: "Maintains execution state.",
  },
]);

void registry;
void builder;
void capabilities;
void new AgentDefinitionCatalog([novelAgentDefinition]);
