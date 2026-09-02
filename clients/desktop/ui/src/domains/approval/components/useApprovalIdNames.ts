/**
 * useApprovalIdNames
 *
 * 审批参数的 id → 实体名称映射异步解析 hook：待审参数组就绪时拉取一次
 * 全量映射（大纲/角色/地点/卷章），供 ParameterView / LeafPlanCard 把
 * id 引用字段渲染为名称；undefined（未就绪/未注入）时调用方回退原值。
 * cancelled 守卫丢弃过期结果，防止选中切换竞态。
 */
import { useEffect, useState } from "react";
import type { ApprovalIdNameResolver } from "../approvalEntityResolver.js";
import type { ArgumentGroup } from "./useApprovalEntityResolution.js";

/**
 * 解析当前审批参数组涉及的 id → 名称映射。
 * @param groups 参数组（undefined / 解析器未注入时不解析）
 * @param resolveIdNames 名称映射解析器（宿主注入）
 * @returns id → 名称映射（未就绪为 undefined）
 */
export function useApprovalIdNames(
  groups: readonly ArgumentGroup[] | undefined,
  resolveIdNames: ApprovalIdNameResolver | undefined,
): ReadonlyMap<string, string> | undefined {
  const [names, setNames] = useState<ReadonlyMap<string, string> | undefined>(undefined);

  useEffect(() => {
    if (groups === undefined || resolveIdNames === undefined) {
      setNames(undefined);
      return;
    }
    let cancelled = false;
    void resolveIdNames()
      .catch(() => undefined)
      .then((resolved) => {
        if (cancelled) return;
        setNames(resolved);
      });
    return () => {
      cancelled = true;
    };
  }, [groups, resolveIdNames]);

  return names;
}
