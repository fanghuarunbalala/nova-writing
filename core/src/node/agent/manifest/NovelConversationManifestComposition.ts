/** Production assembly dependencies for the default Novel Conversation Agent. */
import {
  SystemPromptBuilder,
  createDefaultPromptSectionRegistry,
  type PromptDigester,
} from "../../../prompt/index.js";
import type { ConversationTodoWriter } from "../../../runtime/todo/index.js";
import { ToolGroupCatalog } from "../../../tooling/group/index.js";
import { loadToolGroupManifest } from "../../../tooling/group/index.js";
import { ToolRegistry } from "../../../tooling/registry/index.js";
import { createTodoWriteTool } from "../../../tools/todo/index.js";
import { NodeSha256PromptDigester } from "../../prompt/index.js";

export interface NovelConversationManifestComposition {
  readonly registry: ToolRegistry;
  readonly groups: ToolGroupCatalog;
  readonly promptBuilder: SystemPromptBuilder;
  readonly digester: PromptDigester;
}

export interface CreateNovelConversationManifestCompositionOptions {
  readonly todoWriter?: ConversationTodoWriter;
}

const NOVEL_CONVERSATION_TOOL_GROUP_MANIFEST = `
schemaVersion: 1
id: runtime.todo
version: 1.0.0
label: Runtime todo tools
tools: [TodoWrite]
`;

const unavailableTodoWriter: ConversationTodoWriter = Object.freeze({
  replace() {
    return Promise.reject(
      new TypeError(
        "Conversation todo writer is unavailable during manifest assembly",
      ),
    );
  },
});

export function createNovelConversationManifestComposition(
  options: CreateNovelConversationManifestCompositionOptions = {},
): NovelConversationManifestComposition {
  const digester = new NodeSha256PromptDigester();
  const registry = new ToolRegistry([
    createTodoWriteTool({
      writer: options.todoWriter ?? unavailableTodoWriter,
    }),
  ]);
  const groups = new ToolGroupCatalog([
    loadToolGroupManifest(NOVEL_CONVERSATION_TOOL_GROUP_MANIFEST),
  ]);
  const promptBuilder = new SystemPromptBuilder({
    sections: createDefaultPromptSectionRegistry(),
    digester,
  });
  return Object.freeze({ registry, groups, promptBuilder, digester });
}
