/**
 * 工具策略：AgentDefinition.tools 的 allow/deny 名单过滤（对齐旧版 AgentToolPolicy，
 * 不引入 groupIds——新线无工具分组机制，池 = 装配池或注册表版本匹配集，见 architecture.md 偏离清单）。
 * 语义：（allow 未定义 ? 全池 : 池∩allow）− deny；allow/deny 名单项按 name 须在池内，
 * 否则抛 TOOL_POLICY_INVALID（对齐旧版 validateKnownTools 抛错，非静默跳过）；保池序
 * （toolDefs 顺序决定 system prompt 中 ToolPolicy 块顺序，不重排）。
 */
import type { ToolDef } from "./ToolDef.js";
import { ToolError } from "./errors.js";

/**
 * 工具过滤名单（allow/deny 按工具名过滤）。
 * 与 AgentDefinition.AgentToolPolicy（组清单 + allow/deny 值对象）结构兼容：
 * 装配侧 applyToolPolicy 只消费过滤字段，组清单由 AgentAssembler 消费。
 */
export interface ToolPolicyFilter {
  /** 白名单：存在时与池取交集（未命中的池项静默跳过；空数组 = 空工具集） */
  allow?: readonly string[];
  /** 黑名单：从结果差集移除 */
  deny?: readonly string[];
}

/**
 * 应用工具策略过滤工具池
 * @param toolDefs 工具池（装配池或注册表版本匹配集）
 * @param policy 工具策略（缺省不过滤，返回全池副本）
 * @returns 过滤后的工具定义（保池序）
 */
export function applyToolPolicy(
  toolDefs: readonly ToolDef[],
  policy?: ToolPolicyFilter,
): ToolDef[] {
  if (!policy) return [...toolDefs];
  const byName = new Map(toolDefs.map((t) => [t.name, t]));
  const validate = (names: readonly string[] | undefined, kind: "allow" | "deny"): void => {
    for (const name of names ?? []) {
      if (!byName.has(name)) {
        throw new ToolError(
          { code: "TOOL_POLICY_INVALID", toolName: name },
          `工具策略${kind === "allow" ? "白" : "黑"}名单未注册: ${name}`,
        );
      }
    }
  };
  validate(policy.allow, "allow");
  validate(policy.deny, "deny");
  const allow = policy.allow === undefined ? undefined : new Set(policy.allow);
  const deny = new Set(policy.deny ?? []);
  return toolDefs.filter((t) => (allow === undefined || allow.has(t.name)) && !deny.has(t.name));
}
