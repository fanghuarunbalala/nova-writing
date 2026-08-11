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
  {
    // 提交说明/修订摘要：仅审批上下文辅助，确认对象是 design 文件内容本身。
    // Submission note / revision summary: auxiliary approval context only —
    // the confirmation subject is the design file content itself.
    summary: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
  },
  { additionalProperties: false },
);
export type ExitComposeModeArguments = Static<
  typeof ExitComposeModeParametersSchema
>;
