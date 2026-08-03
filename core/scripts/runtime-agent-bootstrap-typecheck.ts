/** Compile-time examples for restoring Agent Runtime configuration from Bootstrap. */
import {
  AgentAssemblyRestorer,
  AgentRuntimeConfigurationFactory,
  InMemoryAgentRuntimeConfigurationProfileResolver,
  type ConversationRuntimeBootstrap,
} from "../src/index.js";

const restorer: AgentAssemblyRestorer = undefined as never;
const profiles: InMemoryAgentRuntimeConfigurationProfileResolver = undefined as never;
const factory: AgentRuntimeConfigurationFactory = undefined as never;
const bootstrap: ConversationRuntimeBootstrap = undefined as never;

void restorer.restore;
void profiles.resolve;
void factory.create(bootstrap);
