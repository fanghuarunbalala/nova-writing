/** Package-private conversion between Core Tools and Pi AgentTool values. */
import type {
  AgentTool,
  AgentToolResult,
  AgentToolUpdateCallback,
} from "@earendil-works/pi-agent-core";
import type { Static, TSchema } from "typebox";
import type { JsonValue } from "../../../event/protocol/index.js";
import type { ArtifactReference } from "../../../storage/artifact/index.js";
import type {
  RegisteredTool,
  ToolExecutionUpdate,
  ToolProgressSink,
  ToolResult,
} from "../../../tooling/index.js";

export interface PiToolExecutionRequest {
  readonly tool: RegisteredTool;
  readonly toolCallId: string;
  readonly arguments: unknown;
  readonly signal: AbortSignal;
  readonly progress: ToolProgressSink;
}

export interface PiToolExecutionBridge {
  execute(request: PiToolExecutionRequest): Promise<ToolResult>;
}

export type PiToolAdapterDetails =
  | {
      readonly kind: "progress";
      readonly completed?: number;
      readonly total?: number;
    }
  | {
      readonly kind: "partial_result";
    }
  | {
      readonly kind: "result";
      readonly details?: JsonValue;
      readonly artifacts?: readonly ArtifactReference[];
    };

export class PiToolAdapter {
  constructor(private readonly execution: PiToolExecutionBridge) {}

  toAgentTool<TParameters extends TSchema>(
    tool: RegisteredTool<TParameters>,
  ): AgentTool<TParameters, PiToolAdapterDetails> {
    return Object.freeze({
      name: tool.descriptor.name,
      label: tool.descriptor.label,
      description: tool.descriptor.description,
      parameters: tool.descriptor.parameters,
      execute: async (
        toolCallId: string,
        arguments_: Static<TParameters>,
        signal?: AbortSignal,
        onUpdate?: AgentToolUpdateCallback<PiToolAdapterDetails>,
      ): Promise<AgentToolResult<PiToolAdapterDetails>> => {
        const result = await this.execution.execute({
          tool,
          toolCallId,
          arguments: arguments_,
          signal: signal ?? new AbortController().signal,
          progress: createPiToolProgressSink(onUpdate),
        });
        return toPiToolResult(result);
      },
    });
  }

  toAgentTools(
    tools: readonly RegisteredTool[],
  ): readonly AgentTool<TSchema, PiToolAdapterDetails>[] {
    return Object.freeze(tools.map((tool) => this.toAgentTool(tool)));
  }
}

function createPiToolProgressSink(
  onUpdate: AgentToolUpdateCallback<PiToolAdapterDetails> | undefined,
): ToolProgressSink {
  return Object.freeze({
    async emit(update: ToolExecutionUpdate): Promise<void> {
      if (!onUpdate) return;
      onUpdate(toPiToolUpdate(update));
    },
  });
}

function toPiToolUpdate(
  update: ToolExecutionUpdate,
): AgentToolResult<PiToolAdapterDetails> {
  if (update.kind === "partial_result") {
    return {
      content: [...update.content],
      details: Object.freeze({ kind: "partial_result" }),
    };
  }
  return {
    content:
      update.message === undefined
        ? []
        : [{ type: "text", text: update.message }],
    details: Object.freeze({
      kind: "progress",
      ...(update.completed === undefined
        ? {}
        : { completed: update.completed }),
      ...(update.total === undefined ? {} : { total: update.total }),
    }),
  };
}

function toPiToolResult(
  result: ToolResult,
): AgentToolResult<PiToolAdapterDetails> {
  return {
    content: [...result.content],
    details: Object.freeze({
      kind: "result",
      ...(result.details === undefined ? {} : { details: result.details }),
      ...(result.artifacts === undefined ? {} : { artifacts: result.artifacts }),
    }),
  };
}
