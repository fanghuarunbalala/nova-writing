/**
 * ScheduleStore
 *
 * 派生 store：订阅 novel overview / outline / conversation catalog，
 * 任何上游 notify 后重算 stats / todos / progressTree。
 * 说明：approval 队列上游暂缺（approval 域延后），依赖注入为可选。
 */
import type { Logger } from "@novel/core";
import { noopLogger } from "@novel/core/client";
import { ExternalStore } from "../../../shared/state/ExternalStore.js";
import { ImmutableSnapshot } from "../../../shared/state/ImmutableSnapshot.js";
import type { ConversationCatalogStore } from "../../conversation/store/ConversationCatalogStore.js";
import type { NovelOverviewStore } from "../../novel/overview/NovelOverviewStore.js";
import type { StoryOutlineTreeStore } from "../../novel/outline/store/StoryOutlineTreeStore.js";
import {
  ScheduleProjection,
  type ScheduleProgressUnitData,
  type ScheduleStatData,
  type ScheduleTodoData,
} from "../projection/ScheduleProjection.js";

export interface ScheduleSnapshot {
  readonly phase: "idle" | "loading" | "ready" | "error";
  readonly workspaceId: string | undefined;
  readonly stats: readonly ScheduleStatData[];
  readonly axisFlow: {
    readonly planAxis: readonly string[];
    readonly realAxis: readonly string[];
  };
  readonly todos: readonly ScheduleTodoData[];
  readonly progressTree: readonly ScheduleProgressUnitData[];
  readonly errorMessage: string | undefined;
}

const EMPTY_SNAPSHOT: ScheduleSnapshot = Object.freeze({
  phase: "idle",
  workspaceId: undefined,
  stats: Object.freeze([]),
  axisFlow: Object.freeze({
    planAxis: Object.freeze(["idea", "outlined", "ready"]),
    realAxis: Object.freeze(["pending", "in-progress", "completed", "abandoned"]),
  }),
  todos: Object.freeze([]),
  progressTree: Object.freeze([]),
  errorMessage: undefined,
});

export interface ScheduleStoreDeps {
  readonly novelOverview: NovelOverviewStore;
  readonly outlineTree: StoryOutlineTreeStore;
  readonly conversationCatalog: ConversationCatalogStore;
  readonly logger?: Logger;
}

export class ScheduleStore extends ExternalStore<ScheduleSnapshot> {
  private readonly deps: ScheduleStoreDeps;
  private readonly logger: Logger;

  constructor(deps: ScheduleStoreDeps) {
    super(EMPTY_SNAPSHOT);
    this.deps = deps;
    this.logger = (deps.logger ?? noopLogger).child({
      component: "schedule_store",
    });
    deps.novelOverview.subscribe(this.recompute);
    deps.outlineTree.subscribe(this.recompute);
    deps.conversationCatalog.subscribe(this.recompute);
    this.recompute();
  }

  recompute = (): void => {
    const overview = this.deps.novelOverview.getSnapshot();
    const outline = this.deps.outlineTree.getSnapshot();
    const conversation = this.deps.conversationCatalog.getSnapshot();

    let phase: ScheduleSnapshot["phase"] = "ready";
    let errorMessage: string | undefined;
    const upstream = [overview, outline, conversation];
    if (upstream.some((item) => item.phase === "error")) {
      phase = "error";
      errorMessage = "计划视图依赖的数据加载失败";
    } else if (upstream.some((item) => item.phase === "loading")) {
      phase = "loading";
    } else if (upstream.some((item) => item.phase === "idle")) {
      phase = "idle";
    }

    const workspaceId =
      overview.workspaceId ?? outline.workspaceId ?? conversation.workspaceId;
    const next: ScheduleSnapshot = {
      phase,
      workspaceId,
      stats: phase === "ready" ? ScheduleProjection.deriveStats(overview, outline) : Object.freeze([]),
      axisFlow: EMPTY_SNAPSHOT.axisFlow,
      todos: phase === "ready" ? ScheduleProjection.deriveTodos(overview, conversation) : Object.freeze([]),
      progressTree:
        phase === "ready" ? ScheduleProjection.deriveProgressTree(outline) : Object.freeze([]),
      errorMessage,
    };
    if (ImmutableSnapshot.deepEqual(next, this.snapshot)) return;
    this.setSnapshot(next);
    this.logger.debug("schedule_store.recomputed", { phase });
  };
}
