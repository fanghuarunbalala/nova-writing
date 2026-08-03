/** Core-owned Tool identity and TypeBox parameter-schema contract. */
import type { Static, TSchema } from "typebox";

export interface ToolDescriptor<TParameters extends TSchema = TSchema> {
  readonly name: string;
  readonly version: string;
  readonly label: string;
  readonly description: string;
  readonly parameters: TParameters;
}

export type ToolArguments<TParameters extends TSchema> = Static<TParameters>;
