/**
 * novel 域工具（从旧 main 分支迁移，对齐当前 novel 域：直接落库、无 Draft/revision）。
 * character / location 两域同构（都用稳定实体档案）。
 */
import type { ToolDef } from "../ToolDef.js";
import type { ToolCall } from "../../provider/types.js";
import type { NovelHandle } from "../../../novel/client/NovelHandle.js";

/** 解析 tool args JSON */
function parseArgs(call: ToolCall): Record<string, unknown> {
  try {
    return JSON.parse(call.args) as Record<string, unknown>;
  } catch {
    throw new Error(`无效的 JSON 参数: ${call.args}`);
  }
}

/** 实体档案输入（name + 别名 + 摘要 + 初始状态 + 作者备注） */
interface EntityInput {
  name: string;
  aliases?: readonly string[];
  summary?: string;
  initialState?: string;
  authorNotes?: string;
}

/**
 * 创建 character 工具（Read/Write/Edit），handler 对接 NovelHandle
 * @param handle novel 客户端（query/mutate）
 * @returns 角色工具定义
 */
export function createCharacterTools(handle: NovelHandle): ToolDef[] {
  return [characterRead(handle), characterWrite(handle), characterEdit(handle)];
}

function characterRead(handle: NovelHandle): ToolDef {
  return {
    name: "CharacterRead",
    version: "1.0.0",
    description:
      "读取角色档案。省略 characterId 列出全部角色；传入则读取单个角色。返回的是已提交（正式稿）状态。",
    parameters: {
      type: "object",
      properties: { characterId: { type: "string" } },
      additionalProperties: false,
    },
    promptDetail: {
      policy: "Reads committed (canonical) Character profiles. Omit characterId to list all.",
      guidance: "The returned profile is the source for CharacterWrite and CharacterEdit values.",
    },
    handler: {
      execute: async (call) => {
        const args = parseArgs(call);
        const id = args.characterId as string | undefined;
        const result = id
          ? await handle.query({ op: "characters.get", characterId: id as never })
          : await handle.query({ op: "characters.list" });
        return JSON.stringify(result, null, 2);
      },
    },
  };
}

function characterWrite(handle: NovelHandle): ToolDef {
  return {
    name: "CharacterWrite",
    version: "1.0.0",
    description:
      "批量创建角色档案。name 必填；aliases/summary/initialState/authorNotes 可选。创建直接写入正式稿。",
    parameters: {
      type: "object",
      properties: {
        values: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              aliases: { type: "array", items: { type: "string" } },
              summary: { type: "string" },
              initialState: { type: "string" },
              authorNotes: { type: "string" },
            },
            required: ["name"],
            additionalProperties: false,
          },
        },
      },
      required: ["values"],
      additionalProperties: false,
    },
    promptDetail: {
      policy: "Batch-creates Character profiles.",
      guidance: "name is required; aliases may be empty; summary/initialState/authorNotes are optional. Applies to canonical immediately.",
    },
    handler: {
      execute: async (call) => {
        const args = parseArgs(call);
        const values = (args.values as EntityInput[]) ?? [];
        const results: unknown[] = [];
        for (const v of values) {
          results.push(await handle.mutate({ op: "character.create", input: v }));
        }
        return JSON.stringify(results, null, 2);
      },
    },
  };
}

function characterEdit(handle: NovelHandle): ToolDef {
  return {
    name: "CharacterEdit",
    version: "1.0.0",
    description:
      "批量字段级局部更新（PATCH）已有角色档案。characterId 必填；提供的字段覆盖，未提供保留；null 清除 summary/initialState/authorNotes；[] 清除 aliases。",
    parameters: {
      type: "object",
      properties: {
        values: {
          type: "array",
          items: {
            type: "object",
            properties: {
              characterId: { type: "string" },
              patch: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  aliases: { type: "array", items: { type: "string" } },
                  summary: { type: ["string", "null"] },
                  initialState: { type: ["string", "null"] },
                  authorNotes: { type: ["string", "null"] },
                },
                additionalProperties: false,
              },
            },
            required: ["characterId", "patch"],
            additionalProperties: false,
          },
        },
      },
      required: ["values"],
      additionalProperties: false,
    },
    promptDetail: {
      policy: "Batch field-level partial updates (PATCH) of existing Character profiles.",
      guidance: "Read first with CharacterRead, then Edit only the fields you need. Use null to clear; [] to clear aliases.",
    },
    handler: {
      execute: async (call) => {
        const args = parseArgs(call);
        const values = (args.values as Array<{ characterId: string; patch: Partial<EntityInput> }>) ?? [];
        const results: unknown[] = [];
        for (const v of values) {
          results.push(await handle.mutate({ op: "character.update", characterId: v.characterId as never, patch: v.patch }));
        }
        return JSON.stringify(results, null, 2);
      },
    },
  };
}

/**
 * 创建 location 工具（Read/Write/Edit），与 character 同构（都用稳定实体档案）
 * @param handle novel 客户端
 * @returns 地点工具定义
 */
export function createLocationTools(handle: NovelHandle): ToolDef[] {
  return [locationRead(handle), locationWrite(handle), locationEdit(handle)];
}

function locationRead(handle: NovelHandle): ToolDef {
  return {
    name: "LocationRead",
    version: "1.0.0",
    description: "读取地点档案。省略 locationId 列出全部地点；传入则读取单个。返回已提交（正式稿）状态。",
    parameters: {
      type: "object",
      properties: { locationId: { type: "string" } },
      additionalProperties: false,
    },
    promptDetail: {
      policy: "Reads committed (canonical) Location profiles.",
      guidance: "Omit locationId to list all; the returned profile is the source for LocationWrite/LocationEdit.",
    },
    handler: {
      execute: async (call) => {
        const args = parseArgs(call);
        const id = args.locationId as string | undefined;
        const result = id
          ? await handle.query({ op: "locations.get", locationId: id as never })
          : await handle.query({ op: "locations.list" });
        return JSON.stringify(result, null, 2);
      },
    },
  };
}

function locationWrite(handle: NovelHandle): ToolDef {
  return {
    name: "LocationWrite",
    version: "1.0.0",
    description: "批量创建地点档案。name 必填；aliases/summary/initialState/authorNotes 可选。直接写入正式稿。",
    parameters: {
      type: "object",
      properties: {
        values: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              aliases: { type: "array", items: { type: "string" } },
              summary: { type: "string" },
              initialState: { type: "string" },
              authorNotes: { type: "string" },
            },
            required: ["name"],
            additionalProperties: false,
          },
        },
      },
      required: ["values"],
      additionalProperties: false,
    },
    promptDetail: {
      policy: "Batch-creates Location profiles.",
      guidance: "name is required; applies to canonical immediately.",
    },
    handler: {
      execute: async (call) => {
        const args = parseArgs(call);
        const values = (args.values as EntityInput[]) ?? [];
        const results: unknown[] = [];
        for (const v of values) results.push(await handle.mutate({ op: "location.create", input: v }));
        return JSON.stringify(results, null, 2);
      },
    },
  };
}

function locationEdit(handle: NovelHandle): ToolDef {
  return {
    name: "LocationEdit",
    version: "1.0.0",
    description: "批量字段级局部更新（PATCH）已有地点档案。locationId 必填；字段覆盖/保留，null 清除。",
    parameters: {
      type: "object",
      properties: {
        values: {
          type: "array",
          items: {
            type: "object",
            properties: {
              locationId: { type: "string" },
              patch: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  aliases: { type: "array", items: { type: "string" } },
                  summary: { type: ["string", "null"] },
                  initialState: { type: ["string", "null"] },
                  authorNotes: { type: ["string", "null"] },
                },
                additionalProperties: false,
              },
            },
            required: ["locationId", "patch"],
            additionalProperties: false,
          },
        },
      },
      required: ["values"],
      additionalProperties: false,
    },
    promptDetail: {
      policy: "Batch field-level partial updates (PATCH) of existing Location profiles.",
      guidance: "Read first, then Edit only the fields you need. Use null to clear; [] to clear aliases.",
    },
    handler: {
      execute: async (call) => {
        const args = parseArgs(call);
        const values = (args.values as Array<{ locationId: string; patch: Partial<EntityInput> }>) ?? [];
        const results: unknown[] = [];
        for (const v of values) {
          results.push(await handle.mutate({ op: "location.update", locationId: v.locationId as never, patch: v.patch }));
        }
        return JSON.stringify(results, null, 2);
      },
    },
  };
}

/**
 * 创建 paragraph 工具（Read/Write/Edit），段落归属 story unit
 * @param handle novel 客户端
 * @returns 段落工具定义
 */
export function createParagraphTools(handle: NovelHandle): ToolDef[] {
  return [
    {
      name: "ParagraphRead",
      version: "1.0.0",
      description: "读取段落。省略 paragraphId 时按 storyUnitId 列出该单元的全部段落（按 orderKey 排序）；传入 paragraphId 读取单个。",
      parameters: {
        type: "object",
        properties: { storyUnitId: { type: "string" }, paragraphId: { type: "string" } },
        additionalProperties: false,
      },
      promptDetail: { policy: "Reads committed Paragraph content.", guidance: "List by storyUnitId, or read one by paragraphId." },
      handler: {
        execute: async (call) => {
          const args = parseArgs(call);
          const result = args.paragraphId
            ? await handle.query({ op: "paragraph.get", paragraphId: args.paragraphId as never })
            : await handle.query({ op: "paragraphs.list", storyUnitId: args.storyUnitId as never });
          return JSON.stringify(result, null, 2);
        },
      },
    },
    {
      name: "ParagraphWrite",
      version: "1.0.0",
      description: "在指定 story unit 下插入新段落。storyUnitId 必填；orderKey 控制排序；text 为段落正文。",
      parameters: {
        type: "object",
        properties: {
          storyUnitId: { type: "string" },
          orderKey: { type: "string" },
          text: { type: "string" },
        },
        required: ["storyUnitId", "text"],
        additionalProperties: false,
      },
      promptDetail: { policy: "Inserts a Paragraph into a story unit.", guidance: "storyUnitId required; orderKey optional for ordering." },
      handler: {
        execute: async (call) => {
          const args = parseArgs(call);
          const r = await handle.mutate({ op: "paragraph.insert", storyUnitId: args.storyUnitId as never, orderKey: args.orderKey as never, text: String(args.text) });
          return JSON.stringify(r, null, 2);
        },
      },
    },
    {
      name: "ParagraphEdit",
      version: "1.0.0",
      description: "替换段落文本（不可变段落：update 整体替换）。paragraphId 必填。",
      parameters: {
        type: "object",
        properties: { paragraphId: { type: "string" }, text: { type: "string" } },
        required: ["paragraphId", "text"],
        additionalProperties: false,
      },
      promptDetail: { policy: "Replaces Paragraph text.", guidance: "paragraphId required; text replaces the whole paragraph." },
      handler: {
        execute: async (call) => {
          const args = parseArgs(call);
          const r = await handle.mutate({ op: "paragraph.update", paragraphId: args.paragraphId as never, text: String(args.text) });
          return JSON.stringify(r, null, 2);
        },
      },
    },
  ];
}
