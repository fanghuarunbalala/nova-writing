import {
  DefaultChildConversationManager,
  SUBAGENT_TOOL_POLICY_RELATION,
  type ChildConversationManager,
  type DefaultChildConversationManagerOptions,
} from "../src/index.js";

declare const options: DefaultChildConversationManagerOptions;
const manager: ChildConversationManager = new DefaultChildConversationManager(options);
const relation: "same" | "reduced" = SUBAGENT_TOOL_POLICY_RELATION.reduced;

void manager;
void relation;
