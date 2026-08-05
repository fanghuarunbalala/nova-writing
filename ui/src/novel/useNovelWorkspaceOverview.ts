/** Loads canonical Novel overview when a shared UI Workspace becomes active. */
import {
  ApiRemoteError,
  ApiTransportError,
  canonicalNovelQueryScope,
  type NovelOverviewSnapshot,
} from "@novel/core";
import { useEffect, useState } from "react";
import { useNovelApi } from "../client/index.js";

export type NovelWorkspaceOverviewState =
  | { readonly phase: "idle" }
  | { readonly phase: "loading"; readonly workspaceId: string }
  | {
      readonly phase: "ready";
      readonly workspaceId: string;
      readonly overview: NovelOverviewSnapshot;
    }
  | {
      readonly phase: "error";
      readonly workspaceId: string;
      readonly code: string;
      readonly retryable: boolean;
    };

const IDLE_STATE = Object.freeze({ phase: "idle" }) satisfies NovelWorkspaceOverviewState;

export function useNovelWorkspaceOverview(
  workspaceId: string | undefined,
): NovelWorkspaceOverviewState {
  const { api, logger } = useNovelApi();
  const [state, setState] = useState<NovelWorkspaceOverviewState>(IDLE_STATE);

  useEffect(() => {
    if (workspaceId === undefined) {
      setState(IDLE_STATE);
      return undefined;
    }
    let cancelled = false;
    setState(Object.freeze({ phase: "loading", workspaceId }));
    logger.debug("novel_ui.overview_load_started", { workspaceId });
    void api.novel.overview.get(canonicalNovelQueryScope).then(
      (overview) => {
        if (cancelled) return;
        if (overview.workspaceId !== workspaceId) {
          const failure = Object.freeze({
            phase: "error",
            workspaceId,
            code: "NOVEL_WORKSPACE_MISMATCH",
            retryable: false,
          }) satisfies NovelWorkspaceOverviewState;
          setState(failure);
          logger.info("novel_ui.overview_load_failed", {
            workspaceId,
            errorCode: failure.code,
            retryable: failure.retryable,
          });
          return;
        }
        setState(Object.freeze({ phase: "ready", workspaceId, overview }));
        logger.debug("novel_ui.overview_load_completed", {
          workspaceId,
          novelId: overview.novelId,
        });
      },
      (error: unknown) => {
        if (cancelled) return;
        const failure = captureFailure(error);
        setState(Object.freeze({ phase: "error", workspaceId, ...failure }));
        logger.info("novel_ui.overview_load_failed", {
          workspaceId,
          errorCode: failure.code,
          retryable: failure.retryable,
        });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [api, logger, workspaceId]);

  return state;
}

function captureFailure(error: unknown): {
  readonly code: string;
  readonly retryable: boolean;
} {
  if (error instanceof ApiRemoteError || error instanceof ApiTransportError) {
    return Object.freeze({ code: error.code, retryable: error.retryable });
  }
  return Object.freeze({
    code: "NOVEL_OVERVIEW_LOAD_FAILED",
    retryable: false,
  });
}
