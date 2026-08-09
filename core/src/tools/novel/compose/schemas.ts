/**
 * Enter/ExitComposeMode 工具参数 schema。
 * Parameter schemas for the EnterComposeMode and ExitComposeMode tools.
 */
import { Type, type Static } from "typebox";

export const EnterComposeModeParametersSchema = Type.Object(
  {
    purpose: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
  },
  { additionalProperties: false },
);
export type EnterComposeModeArguments = Static<
  typeof EnterComposeModeParametersSchema
>;

export const ExitComposeModeParametersSchema = Type.Object(
  {},
  { additionalProperties: false },
);
export type ExitComposeModeArguments = Static<
  typeof ExitComposeModeParametersSchema
>;
