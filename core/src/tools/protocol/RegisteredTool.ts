/** Immutable composition of Tool metadata and its executable Handler binding. */
import type { TSchema } from "typebox";
import type { JsonValue } from "../../event/protocol/index.js";
import type { ToolDescriptor } from "./ToolDescriptor.js";
import type { ToolHandler } from "./ToolHandler.js";

export interface RegisteredTool<
  TParameters extends TSchema = TSchema,
  TDetails extends JsonValue = JsonValue,
> {
  readonly descriptor: ToolDescriptor<TParameters>;
  readonly handler: ToolHandler<TParameters, TDetails>;
}
