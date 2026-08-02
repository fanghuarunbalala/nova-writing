/** Public content-safe OutputEvent requesting review of one exact ChangeSet. */
import {
  NovelOutputEvent,
  OutputPayload,
  type JsonObject,
} from "../../event/index.js";
import {
  captureNovelApprovalRequest,
  type NovelApprovalRequest,
} from "../approval/index.js";

export class NovelApprovalRequestedOutputPayload extends OutputPayload {
  constructor(readonly request: NovelApprovalRequest) {
    super();
  }

  toObject(): JsonObject {
    return {
      requestVersion: this.request.requestVersion,
      approvalRequestId: this.request.approvalRequestId,
      novelId: this.request.novelId,
      draftSessionId: this.request.draftSessionId,
      baseRevision: this.request.baseRevision,
      changeSetDigest: this.request.changeSetDigest,
      operationIds: [...this.request.operationIds],
    };
  }
}

export class NovelApprovalRequestedOutputEvent extends NovelOutputEvent {
  readonly request: NovelApprovalRequest;

  constructor(requestInput: NovelApprovalRequest) {
    const request = captureNovelApprovalRequest(requestInput);
    super(
      "approval.requested",
      new NovelApprovalRequestedOutputPayload(request),
      {
        id: request.approvalRequestId,
        conversationId: request.conversationId,
        timestamp: request.requestedAt,
      },
    );
    this.request = request;
  }
}
