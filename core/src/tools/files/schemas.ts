/**
 * runtime.files 工具组（Read/Glob/Write/Edit）的 TypeBox schema 与工具可见 JSON 契约。
 * TypeBox schemas and tool-visible JSON contracts for the runtime.files tool group.
 *
 * 参数与行为对齐 CCB（参考 docs/ccb-runtime-files-reference.md），代码自研。
 */
import { Type, type Static } from "typebox";

const PATH_MAX = 1024;
const CONTENT_MAX = 512 * 1024;

/** Read 参数：file_path + 可选行范围。Read arguments: file_path plus optional line window. */
export const FileReadParametersSchema = Type.Object(
  {
    file_path: Type.String({ minLength: 1, maxLength: PATH_MAX }),
    offset: Type.Optional(Type.Integer({ minimum: 0 })),
    limit: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { additionalProperties: false },
);
export type FileReadArguments = Static<typeof FileReadParametersSchema>;

/** Glob 参数：workspace 沙盒内的匹配模式。Glob arguments: a pattern inside the workspace sandbox. */
export const FileGlobParametersSchema = Type.Object(
  {
    pattern: Type.String({ minLength: 1, maxLength: PATH_MAX }),
  },
  { additionalProperties: false },
);
export type FileGlobArguments = Static<typeof FileGlobParametersSchema>;

/** Write 参数：目标文件路径 + 全文。Write arguments: target path plus full content. */
export const FileWriteParametersSchema = Type.Object(
  {
    file_path: Type.String({ minLength: 1, maxLength: PATH_MAX }),
    content: Type.String({ maxLength: CONTENT_MAX }),
  },
  { additionalProperties: false },
);
export type FileWriteArguments = Static<typeof FileWriteParametersSchema>;

/** Edit 参数：文件路径 + 精确替换串（兼容别名 old_str/new_str 在 normalize 阶段转正）。 */
/** Edit arguments: file path plus exact replacement strings; legacy old_str/new_str aliases are normalized. */
export const FileEditParametersSchema = Type.Object(
  {
    file_path: Type.String({ minLength: 1, maxLength: PATH_MAX }),
    old_string: Type.String({ minLength: 1, maxLength: CONTENT_MAX }),
    new_string: Type.String({ maxLength: CONTENT_MAX }),
    replace_all: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
export type FileEditArguments = Static<typeof FileEditParametersSchema>;
