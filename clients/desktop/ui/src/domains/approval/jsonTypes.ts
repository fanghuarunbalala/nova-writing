/**
 * jsonTypes
 *
 * 审批参数解析用 JSON 类型（旧版从 @novel/core 导入 JsonValue/JsonObject，
 * 新版 core 无此类型，本地定义）。
 */

/** JSON 值 */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** JSON 对象 */
export type JsonObject = { [key: string]: JsonValue };
