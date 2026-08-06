/** Draft-only Story Outline mutation service that emits deterministic Operations. */
import { noopLogger, type Logger } from "../../observability/index.js";
import {
  captureNovelDraftSession,
  type NovelDraftSession,
} from "../draft/index.js";
import {
  captureStoryOutlineId,
  captureStoryUnitId,
  type NovelOperationId,
  type StoryOutlineId,
  type StoryUnitId,
} from "../identity/index.js";
import {
  captureLeafStoryUnitPlan,
  captureOrderKey,
  captureStoryUnit,
  captureStoryUnitContent,
  type LeafStoryUnitPlan,
  type OrderKey,
  type StoryUnit,
  type StoryUnitContent,
} from "../model/index.js";
import {
  createLeafStoryUnitPlanClearOperation,
  createLeafStoryUnitPlanReplaceOperation,
  createStoryOutlineCreateOperation,
  createStoryUnitCreateOperation,
  createStoryUnitDeleteOperation,
  createStoryUnitMoveOperation,
  createStoryUnitReplaceOperation,
} from "../operation/index.js";
import type { NovelDraftOperationReceipt } from "../port/index.js";
import type { NovelMutationService } from "./NovelMutationService.js";

export interface StoryOutlineServiceOptions {
  readonly mutations: NovelMutationService;
  readonly identityFactory: {
    createOperationId(): NovelOperationId;
  };
  readonly logger?: Logger;
}

export class StoryOutlineService {
  private readonly logger: Logger;

  constructor(private readonly options: StoryOutlineServiceOptions) {
    this.logger = (options.logger ?? noopLogger).child({
      component: "novel_story_outline_service",
    });
  }

  createOutline(
    session: NovelDraftSession,
    id: StoryOutlineId,
  ): Promise<NovelDraftOperationReceipt> {
    const draft = captureNovelDraftSession(session);
    const outlineId = captureStoryOutlineId(id);
    return this.execute(
      draft,
      createStoryOutlineCreateOperation({
        operationId: this.options.identityFactory.createOperationId(),
        outline: { id: outlineId, novelId: draft.novelId },
      }),
      "create",
      { outlineId },
    );
  }

  createStoryUnit(
    session: NovelDraftSession,
    storyUnit: StoryUnit,
  ): Promise<NovelDraftOperationReceipt> {
    const draft = captureNovelDraftSession(session);
    const unit = captureStoryUnit(storyUnit);
    return this.execute(
      draft,
      createStoryUnitCreateOperation({
        operationId: this.options.identityFactory.createOperationId(),
        storyUnit: unit,
      }),
      "story_unit.create",
      { storyUnitId: unit.id },
    );
  }

  replaceStoryUnit(
    session: NovelDraftSession,
    id: StoryUnitId,
    expectedContentDigest: string,
    content: StoryUnitContent,
  ): Promise<NovelDraftOperationReceipt> {
    const draft = captureNovelDraftSession(session);
    const storyUnitId = captureStoryUnitId(id);
    return this.execute(
      draft,
      createStoryUnitReplaceOperation({
        operationId: this.options.identityFactory.createOperationId(),
        storyUnitId,
        expectedContentDigest,
        content: captureStoryUnitContent(content),
      }),
      "story_unit.replace",
      { storyUnitId },
    );
  }

  moveStoryUnit(
    session: NovelDraftSession,
    input: {
      readonly storyUnitId: StoryUnitId;
      readonly expectedParentDigest: string;
      readonly expectedOrderDigest: string;
      readonly parentId?: StoryUnitId;
      readonly orderKey: OrderKey;
    },
  ): Promise<NovelDraftOperationReceipt> {
    const draft = captureNovelDraftSession(session);
    const storyUnitId = captureStoryUnitId(input.storyUnitId);
    return this.execute(
      draft,
      createStoryUnitMoveOperation({
        operationId: this.options.identityFactory.createOperationId(),
        storyUnitId,
        expectedParentDigest: input.expectedParentDigest,
        expectedOrderDigest: input.expectedOrderDigest,
        ...(input.parentId === undefined
          ? {}
          : { parentId: captureStoryUnitId(input.parentId) }),
        orderKey: captureOrderKey(input.orderKey),
      }),
      "story_unit.move",
      { storyUnitId },
    );
  }

  deleteStoryUnit(
    session: NovelDraftSession,
    input: {
      readonly storyUnitId: StoryUnitId;
      readonly expectedContentDigest: string;
      readonly expectedParentDigest: string;
      readonly expectedOrderDigest: string;
    },
  ): Promise<NovelDraftOperationReceipt> {
    const draft = captureNovelDraftSession(session);
    const storyUnitId = captureStoryUnitId(input.storyUnitId);
    return this.execute(
      draft,
      createStoryUnitDeleteOperation({
        operationId: this.options.identityFactory.createOperationId(),
        storyUnitId,
        expectedContentDigest: input.expectedContentDigest,
        expectedParentDigest: input.expectedParentDigest,
        expectedOrderDigest: input.expectedOrderDigest,
      }),
      "story_unit.delete",
      { storyUnitId },
    );
  }

  replaceLeafStoryUnitPlan(
    session: NovelDraftSession,
    plan: LeafStoryUnitPlan,
    expectedPlanDigest?: string,
  ): Promise<NovelDraftOperationReceipt> {
    const draft = captureNovelDraftSession(session);
    const value = captureLeafStoryUnitPlan(plan);
    return this.execute(
      draft,
      createLeafStoryUnitPlanReplaceOperation({
        operationId: this.options.identityFactory.createOperationId(),
        plan: value,
        ...(expectedPlanDigest === undefined ? {} : { expectedPlanDigest }),
      }),
      "leaf_plan.replace",
      { storyUnitId: value.storyUnitId },
    );
  }

  clearLeafStoryUnitPlan(
    session: NovelDraftSession,
    storyUnitIdInput: StoryUnitId,
    expectedPlanDigest: string,
  ): Promise<NovelDraftOperationReceipt> {
    const draft = captureNovelDraftSession(session);
    const storyUnitId = captureStoryUnitId(storyUnitIdInput);
    return this.execute(
      draft,
      createLeafStoryUnitPlanClearOperation({
        operationId: this.options.identityFactory.createOperationId(),
        storyUnitId,
        expectedPlanDigest,
      }),
      "leaf_plan.clear",
      { storyUnitId },
    );
  }

  private async execute(
    session: NovelDraftSession,
    operation: Parameters<NovelMutationService["execute"]>[1],
    action: string,
    identity: Readonly<Record<string, string>>,
  ): Promise<NovelDraftOperationReceipt> {
    this.logger.debug("novel_story_outline.operation.started", {
      novelId: session.novelId,
      draftSessionId: session.id,
      operationId: operation.operationId,
      operationType: operation.type,
      action,
      ...identity,
    });
    const receipt = await this.options.mutations.execute(session, operation);
    this.logger.info("novel_story_outline.operation.completed", {
      novelId: session.novelId,
      draftSessionId: session.id,
      operationId: operation.operationId,
      operationType: operation.type,
      action,
      sequence: receipt.sequence,
      status: receipt.status,
      ...identity,
    });
    return receipt;
  }
}
