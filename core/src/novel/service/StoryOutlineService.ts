/** Canonical Story Outline mutation service that emits deterministic Operations. */
import { noopLogger, type Logger } from "../../observability/index.js";
import {
  captureStoryOutlineId,
  captureStoryUnitId,
  type NovelId,
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
import type {
  NovelCanonicalWritePort,
  NovelCanonicalWriteResult,
} from "../port/index.js";
import { captureNovelRevision, type NovelRevision } from "../version/index.js";
import type { NovelOperation } from "../operation/index.js";

export interface StoryOutlineServiceOptions {
  readonly novelId: NovelId;
  readonly canonicalWrites: NovelCanonicalWritePort;
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
    conversationId: string,
    baseRevision: NovelRevision | undefined,
    id: StoryOutlineId,
  ): Promise<NovelCanonicalWriteResult> {
    const outlineId = captureStoryOutlineId(id);
    return this.execute(
      conversationId,
      baseRevision,
      createStoryOutlineCreateOperation({
        operationId: this.options.identityFactory.createOperationId(),
        outline: { id: outlineId, novelId: this.options.novelId },
      }),
      "create",
      { outlineId },
    );
  }

  createStoryUnit(
    conversationId: string,
    baseRevision: NovelRevision | undefined,
    storyUnit: StoryUnit,
  ): Promise<NovelCanonicalWriteResult> {
    const unit = captureStoryUnit(storyUnit);
    return this.execute(
      conversationId,
      baseRevision,
      createStoryUnitCreateOperation({
        operationId: this.options.identityFactory.createOperationId(),
        storyUnit: unit,
      }),
      "story_unit.create",
      { storyUnitId: unit.id },
    );
  }

  replaceStoryUnit(
    conversationId: string,
    baseRevision: NovelRevision | undefined,
    id: StoryUnitId,
    expectedContentDigest: string,
    content: StoryUnitContent,
  ): Promise<NovelCanonicalWriteResult> {
    const storyUnitId = captureStoryUnitId(id);
    return this.execute(
      conversationId,
      baseRevision,
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
    conversationId: string,
    baseRevision: NovelRevision | undefined,
    input: {
      readonly storyUnitId: StoryUnitId;
      readonly expectedParentDigest: string;
      readonly expectedOrderDigest: string;
      readonly parentId?: StoryUnitId;
      readonly orderKey: OrderKey;
    },
  ): Promise<NovelCanonicalWriteResult> {
    const storyUnitId = captureStoryUnitId(input.storyUnitId);
    return this.execute(
      conversationId,
      baseRevision,
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
    conversationId: string,
    baseRevision: NovelRevision | undefined,
    input: {
      readonly storyUnitId: StoryUnitId;
      readonly expectedContentDigest: string;
      readonly expectedParentDigest: string;
      readonly expectedOrderDigest: string;
    },
  ): Promise<NovelCanonicalWriteResult> {
    const storyUnitId = captureStoryUnitId(input.storyUnitId);
    return this.execute(
      conversationId,
      baseRevision,
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
    conversationId: string,
    baseRevision: NovelRevision | undefined,
    plan: LeafStoryUnitPlan,
    expectedPlanDigest?: string,
  ): Promise<NovelCanonicalWriteResult> {
    const value = captureLeafStoryUnitPlan(plan);
    return this.execute(
      conversationId,
      baseRevision,
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
    conversationId: string,
    baseRevision: NovelRevision | undefined,
    storyUnitIdInput: StoryUnitId,
    expectedPlanDigest: string,
  ): Promise<NovelCanonicalWriteResult> {
    const storyUnitId = captureStoryUnitId(storyUnitIdInput);
    return this.execute(
      conversationId,
      baseRevision,
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
    conversationId: string,
    baseRevision: NovelRevision | undefined,
    operation: NovelOperation,
    action: string,
    identity: Readonly<Record<string, string>>,
  ): Promise<NovelCanonicalWriteResult> {
    this.logger.debug("novel_story_outline.operation.started", {
      operationId: operation.operationId,
      operationType: operation.type,
      action,
      ...identity,
    });
    const result = await this.options.canonicalWrites.applyOperations({
      operations: [operation],
      conversationId,
      ...(baseRevision === undefined
        ? {}
        : { baseRevision: captureNovelRevision(baseRevision) }),
    });
    this.logger.info("novel_story_outline.operation.completed", {
      operationId: operation.operationId,
      operationType: operation.type,
      action,
      resultRevision: result.resultRevision,
      status: result.status,
      ...identity,
    });
    return result;
  }
}
