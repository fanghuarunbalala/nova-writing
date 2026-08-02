/** Candidate-local immutable persistence boundary for resolution application plans. */
import type { NovelResolutionApplicationPlan } from "../conflict/index.js";
import type { NovelDraftSession } from "../draft/index.js";

export interface NovelResolutionApplicationPlanStore {
  savePlan(
    session: NovelDraftSession,
    plan: NovelResolutionApplicationPlan,
  ): Promise<"recorded" | "duplicate">;

  getPlan(
    session: NovelDraftSession,
  ): Promise<NovelResolutionApplicationPlan | undefined>;
}
