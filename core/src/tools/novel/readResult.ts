/**
 * Formats a novel read tool result: real data goes into `content` so the provider
 * serializes it in the current turn, while `details` stays intact for journal rebuild
 * and downstream `details.*` consumers (e.g. ToolDispatcher, next-turn projection).
 *
 * 将真实读取数据放进 `content`（provider 当轮即可序列化给模型，避免"数据被简化"），
 * 同时保留 `details` 供 journal 重建与既有 `details.*` 消费方使用。
 */
import type { JsonValue } from "../../event/index.js";
import type { ToolResult } from "../../tooling/protocol/index.js";

export function formatReadToolResult<T extends JsonValue>(
  details: T,
  header: string,
): ToolResult<T> {
  return Object.freeze({
    content: Object.freeze([
      Object.freeze({
        type: "text" as const,
        text: `${header}\n${JSON.stringify(details, null, 2)}`,
      }),
    ]),
    details,
  });
}
