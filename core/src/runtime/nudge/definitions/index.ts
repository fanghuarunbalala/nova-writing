/**
 * 中央薄 catalog：全部 nudge 定义在此聚合（每域一个文件）。
 * 装配时按 agent `enablesNudges` ∩ 工具组守卫过滤出生效集。
 */
import {
  composeModeExitNudgeDefinition,
  composeModeNudgeDefinition,
} from "./compose.js";
import { todoIdleNudgeDefinition } from "./todo.js";
import type { NudgeDefinition } from "./NudgeDefinition.js";

export type { NudgeDefinition } from "./NudgeDefinition.js";

export { createSystemReminderAttachEffect } from "./effectBuilders.js";

export const NUDGE_DEFINITIONS: readonly NudgeDefinition[] = Object.freeze([
  composeModeNudgeDefinition,
  composeModeExitNudgeDefinition,
  todoIdleNudgeDefinition,
]);
