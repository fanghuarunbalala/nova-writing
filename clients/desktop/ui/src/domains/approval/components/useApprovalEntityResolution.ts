/**
 * useApprovalEntityResolution
 *
 * 审批详情的实体内容异步解析 hook：对每个工具参数组（ArgumentGroup）判断
 * 是否有可解析目标（新增/编辑/删除），有则异步解析目标实体内容；输出逐组
 * 状态（unresolved / loading / ready / error）。effect 清理用 cancelled 守卫
 * 丢弃过期结果，防止选中切换竞态。
 *
 * stale（乐观锁失效）由 lite resolver 逐目标对比 baseRevision vs entityVersion
 * 计算（新版无全局 sourceRevision），ready 时从 contents 聚合。
 *
 * Asynchronously resolves each approval argument group's target entity content
 * (add/edit/delete). Emits per-group status; a cancelled guard discards stale
 * results on selection change.
 */
import { useEffect, useState } from "react";
import type { JsonValue } from "../jsonTypes.js";
import {
  extractApprovalTargets,
  type ApprovalEntityResolver,
  type ResolvedEntityContent,
} from "../approvalEntityResolver.js";

export interface ArgumentGroup {
  readonly toolName: string;
  readonly arguments: JsonValue | undefined;
  readonly op: "add" | "edit" | "delete" | undefined;
}

export type GroupResolution =
  | { readonly status: "unresolved" }
  | { readonly status: "loading"; readonly stale: boolean }
  | {
      readonly status: "ready";
      readonly stale: boolean;
      readonly contents: readonly ResolvedEntityContent[];
    }
  | { readonly status: "error"; readonly stale: boolean };

/**
 * 逐组解析审批目标实体内容。
 * @param groups 参数组（undefined 时不解析）
 * @param resolveEntity 实体解析器（宿主注入）
 * @returns 逐组解析状态
 */
export function useApprovalEntityResolution(
  groups: readonly ArgumentGroup[] | undefined,
  resolveEntity: ApprovalEntityResolver | undefined,
): readonly GroupResolution[] | undefined {
  const [resolutions, setResolutions] = useState<
    readonly GroupResolution[] | undefined
  >(undefined);

  useEffect(() => {
    if (groups === undefined) {
      setResolutions(undefined);
      return;
    }
    let cancelled = false;
    const entries = groups.map((group) => ({
      targets:
        resolveEntity === undefined
          ? undefined
          : extractApprovalTargets(group.toolName, group.op, group.arguments),
    }));
    setResolutions(
      entries.map((entry) =>
        entry.targets === undefined
          ? { status: "unresolved" }
          : { status: "loading", stale: false },
      ),
    );

    for (let index = 0; index < groups.length; index++) {
      const entry = entries[index]!;
      if (entry.targets === undefined) continue;
      const targets = entry.targets.targets;
      void Promise.all(
        targets.map((target) =>
          resolveEntity!(target).catch(() => undefined),
        ),
      ).then((contents) => {
        if (cancelled) return;
        const resolved = contents.filter(
          (content): content is ResolvedEntityContent => content !== undefined,
        );
        const allOk = resolved.length === targets.length;
        setResolutions((previous) => {
          if (previous === undefined) return previous;
          const updated = [...previous];
          updated[index] = allOk
            ? {
                status: "ready",
                stale: resolved.some((content) => content.stale),
                contents: resolved,
              }
            : { status: "error", stale: false };
          return updated;
        });
      });
    }
    return () => {
      cancelled = true;
    };
  }, [groups, resolveEntity]);

  return resolutions;
}
