/**
 * T1 结构化骨架化（docs/PRD/context-compact.md §4）：压缩区原地改写——
 * 通用长度规则（超长工具结果/参数、正文块、长评述 → 一行中文占位）+
 * novel 域乐观锁规则（同实体多次写只保留最后一次调用记录；后写覆盖前读）。
 * 协议约束：tool result 只替换不删除（与 toolCall 按 id 配对，防 provider 400）；
 * 占位前缀即幂等检测标记（重复执行自然短路）。
 */
import type { RunContext } from "../../loop/types.js";
import {
  ARCHIVED_NOVEL_PREFIX,
  ASSISTANT_TEXT_KEEP_HEAD,
  ASSISTANT_TEXT_KEEP_TAIL,
  ASSISTANT_TEXT_TRIM_CHARS,
  COMPACTED_ARGS_COVERED,
  COMPACTED_ARGS_MARK,
  OMITTED_TOOL_RESULT_PREFIX,
  TOOL_ARGS_PLACEHOLDER_CHARS,
  TOOL_RESULT_PLACEHOLDER_CHARS,
  type NovelCallMeta,
} from "./auto-compact-shared.js";
import { isOmittedToolResult, toolResultSuperseded } from "./auto-compact-analyze.js";

/** T1 可剪项计数（幂等检测：已占位的不计；shouldCompact 的工作量判定） */
export function structuralWorkCount(zone: readonly RunContext[], meta: NovelCallMeta): number {
  let count = 0;
  for (const run of zone) {
    for (const msg of run.messages) {
      if (msg.role === "tool" && !isOmittedToolResult(msg.content)) {
        if (toolResultSuperseded(msg.id, msg.content, meta)) count++;
        else if (msg.content.length > TOOL_RESULT_PLACEHOLDER_CHARS) count++;
      } else if (msg.role === "assistant") {
        for (const tc of msg.toolCalls ?? []) {
          if (tc.args.includes(COMPACTED_ARGS_MARK)) continue;
          const call = meta.calls.get(tc.id);
          if (call?.kind === "write" && call.entityIds.size > 0) {
            const isLastForSome = [...call.entityIds].some(
              (id) => meta.lastWrite.get(id)?.callId === tc.id,
            );
            if (!isLastForSome || tc.args.length > TOOL_ARGS_PLACEHOLDER_CHARS) count++;
          } else if (tc.args.length > TOOL_ARGS_PLACEHOLDER_CHARS) {
            count++;
          }
        }
        if (msg.content.includes("```novel") || msg.content.length > ASSISTANT_TEXT_TRIM_CHARS) {
          // 正文块或长评述（占位后长度已降，重复检测自然短路）
          const replaced = trimAssistantText(replaceNovelBlocks(msg.content));
          if (replaced !== msg.content) count++;
        }
      }
    }
  }
  return count;
}

/** T1 骨架化执行（原地改写压缩区消息；返回是否有变化） */
export function skeletonize(zone: readonly RunContext[], meta: NovelCallMeta): boolean {
  let changed = false;
  for (const run of zone) {
    for (const msg of run.messages) {
      if (msg.role === "tool") {
        if (isOmittedToolResult(msg.content)) continue;
        const name = meta.calls.get(msg.id)?.name;
        if (toolResultSuperseded(msg.id, msg.content, meta)) {
          msg.content = `${OMITTED_TOOL_RESULT_PREFIX}：该实体的读取已被后续写入覆盖，请重新查询最新版]`;
          changed = true;
        } else if (msg.content.length > TOOL_RESULT_PLACEHOLDER_CHARS) {
          const label = name !== undefined ? `${name} 结果` : "结果";
          msg.content = `${OMITTED_TOOL_RESULT_PREFIX}：${label}（原 ${msg.content.length} 字）]`;
          changed = true;
        }
      } else if (msg.role === "assistant") {
        for (const tc of msg.toolCalls ?? []) {
          if (tc.args.includes(COMPACTED_ARGS_MARK)) continue;
          const call = meta.calls.get(tc.id);
          if (call?.kind === "write" && call.entityIds.size > 0) {
            const isLastForSome = [...call.entityIds].some(
              (id) => meta.lastWrite.get(id)?.callId === tc.id,
            );
            if (!isLastForSome) {
              // 全部目标实体都被更晚写入覆盖 → 整调用占位（保留 id/name 维持配对）
              tc.args = COMPACTED_ARGS_COVERED;
              changed = true;
            } else if (tc.args.length > TOOL_ARGS_PLACEHOLDER_CHARS) {
              // 最后一次写入：保留调用记录，超大内容参数占位（正式稿为准）；
              // 占位携带结构化 ids——后续扫描轮次仍可据此做 lastWrite 跟踪
              const ids = [...call.entityIds].slice(0, 16);
              tc.args = JSON.stringify({ _compacted: "写入内容已入正式稿", ids });
              changed = true;
            }
          } else if (tc.args.length > TOOL_ARGS_PLACEHOLDER_CHARS) {
            // 非 novel 工具的超长参数同样占位（通用规则）
            tc.args = `{"_compacted":"超长参数已省略（原 ${tc.args.length} 字）"}`;
            changed = true;
          }
        }
        const replaced = trimAssistantText(replaceNovelBlocks(msg.content));
        if (replaced !== msg.content) {
          msg.content = replaced;
          changed = true;
        }
      }
    }
  }
  return changed;
}

/** ```novel 块 → [正文已入档：首行摘要]（正式稿为准） */
function replaceNovelBlocks(text: string): string {
  if (!text.includes("```novel")) return text;
  return text.replace(/```novel[^\n]*\n?([\s\S]*?)```/g, (_match, body: string) => {
    const firstLine =
      String(body)
        .split("\n")
        .find((line) => line.trim().length > 0) ?? "";
    const label = firstLine.trim().slice(0, 24) || "正文";
    return `${ARCHIVED_NOVEL_PREFIX}：${label}]`;
  });
}

/** assistant 长评述头尾截断（保结论与收尾） */
function trimAssistantText(text: string): string {
  if (text.length <= ASSISTANT_TEXT_TRIM_CHARS) return text;
  const omitted = text.length - ASSISTANT_TEXT_KEEP_HEAD - ASSISTANT_TEXT_KEEP_TAIL;
  return `${text.slice(0, ASSISTANT_TEXT_KEEP_HEAD)}\n……（已省略 ${omitted} 字）……\n${text.slice(-ASSISTANT_TEXT_KEEP_TAIL)}`;
}
