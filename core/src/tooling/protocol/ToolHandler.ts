/** Executable Tool contract that returns one final result and may stream progress. */
import type { Static, TSchema } from "typebox";
import type { JsonValue } from "../../event/protocol/index.js";
import type { ToolExecutionContext } from "./ToolExecutionContext.js";
import type { ToolProgressSink } from "./ToolProgress.js";
import type { ToolResult } from "./ToolResult.js";

export interface ToolHandler<
  TParameters extends TSchema = TSchema,
  TDetails extends JsonValue = JsonValue,
> {
  execute(
    context: ToolExecutionContext,
    arguments_: Static<TParameters>,
    progress: ToolProgressSink,
  ): Promise<ToolResult<TDetails>>;
}
