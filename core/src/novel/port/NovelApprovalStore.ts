/** Durable Draft-local Novel Approval persistence and invalidation boundary. */
import type { NovelApprovalInvalidationReason, NovelChangeSetApproval } from "../approval/index.js";
import type { NovelDraftSession } from "../draft/index.js";
import type { NovelDraftSessionId } from "../identity/index.js";
import type { NovelTimestamp } from "../version/index.js";
export interface NovelApprovalStore {
  grantApproval(approval: NovelChangeSetApproval): Promise<"recorded" | "duplicate">;
  getActiveApproval(draftSessionId: NovelDraftSessionId): Promise<NovelChangeSetApproval | undefined>;
  invalidateApproval(session: NovelDraftSession, reason: NovelApprovalInvalidationReason, invalidatedAt: NovelTimestamp): Promise<"invalidated" | "absent">;
}
