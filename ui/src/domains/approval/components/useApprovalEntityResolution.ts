/**
 * useApprovalEntityResolution
 *
 * 审批详情的实体内容异步解析 hook：对每个工具参数组（ArgumentGroup）判断
 * 是否有可解析目标（新增/编辑/删除），有则异步解析目标实体内容；输出逐组
 * 状态（unresolved / loading / ready / error）。effect 清理用 cancelled 守卫
 * 丢弃过期结果，防止选中切换竞态。
 *
 * Asynchronously resolves each approval argument group's target entity content
 * (add/edit/delete). Emits per-group status; a cancelled guard discards stale
 * results on selection change.
 */
import { useEffect, useState } from "react";
import type { JsonValue } from "@novel/core";
import {
  extractApprovalTargets,
  isApprovalStale,
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

export function useApprovalEntityResolution(
  groups: readonly ArgumentGroup[] | undefined,
  resolveEntity: ApprovalEntityResolver | undefined,
  sourceRevision: string | undefined,
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
    const entries = groups.map((group) => {
      const targets =
        resolveEntity === undefined
          ? undefined
          : extractApprovalTargets(group.toolName, group.op, group.arguments);
      return {
        targets,
        stale:
          targets === undefined
            ? false
            : isApprovalStale(group.arguments, sourceRevision),
      };
    });
    setResolutions(
      entries.map((entry) =>
        entry.targets === undefined
          ? { status: "unresolved" }
          : { status: "loading", stale: entry.stale },
      ),
    );

    for (let index = 0; index < groups.length; index++) {
      const entry = entries[index];
      if (entry.targets === undefined) continue;
      void Promise.all(
        entry.targets.targets.map((target) =>
          resolveEntity!(target).catch(() => undefined),
        ),
      ).then((contents) => {
        if (cancelled) return;
        const allOk = contents.every((content) => content !== undefined);
        setResolutions((previous) => {
          if (previous === undefined) return previous;
          const updated = [...previous];
          updated[index] = allOk
            ? {
                status: "ready",
                stale: entry.stale,
                contents: contents.filter(
                  (content): content is ResolvedEntityContent =>
                    content !== undefined,
                ),
              }
            : { status: "error", stale: entry.stale };
          return updated;
        });
      });
    }
    return () => {
      cancelled = true;
    };
  }, [groups, resolveEntity, sourceRevision]);

  return resolutions;
}
