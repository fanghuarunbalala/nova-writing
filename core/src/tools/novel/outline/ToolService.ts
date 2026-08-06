/**
 * Provider-neutral implementation of the confirmed Novel Outline tool
 * semantics on top of platform-neutral Novel application services.
 */
import {
  canonicalStringifyJson,
  type JsonValue,
} from "../../../event/index.js";
import { noopLogger, type Logger } from "../../../observability/index.js";
import {
  FractionalOrderKeyFactory,
  NovelOperationPreconditionError,
  NovelProtocolValidationError,
  StoryOutlineQueryService,
  canonicalNovelReadScope,
  captureCharacterId,
  captureLeafStoryUnitPlan,
  captureLocationId,
  captureOrderKey,
  captureNovelRevision,
  captureRhythmBeatId,
  captureStoryEntityId,
  captureStoryEventStepId,
  captureStoryUnit,
  captureStoryUnitContent,
  captureStoryUnitEntityChangeId,
  captureStoryUnitId,
  createLeafStoryUnitPlanClearOperation,
  createLeafStoryUnitPlanReplaceOperation,
  createStoryOutlineCreateOperation,
  createStoryUnitCreateOperation,
  createStoryUnitMoveOperation,
  createStoryUnitReplaceOperation,
  type LeafStoryUnitPlan,
  type NovelCanonicalWritePort,
  type NovelId,
  type NovelOperation,
  type NovelOperationId,
  type NovelReadScope,
  type OrderKey,
  type OrderKeyFactory,
  type StoryOutlineId,
  type StoryOutlineTree,
  type StoryUnit,
  type StoryUnitAbandonment,
  type StoryUnitBlockState,
  type StoryUnitContent,
  type StoryUnitId,
} from "../../../novel/index.js";
import type {
  LeafPlanToolValue,
  LeafPlanWriteValue,
  NovelOutlineEditArguments,
  NovelOutlineEditValue,
  NovelOutlineItemDetails,
  NovelOutlineReadArguments,
  NovelOutlineReadDetails,
  NovelOutlineUnitDetails,
  NovelOutlineWriteArguments,
  NovelOutlineWriteDetails,
  StoryUnitWriteValue,
} from "./schemas.js";

export interface OutlineToolServiceOptions {
  readonly novelId: NovelId;
  readonly outlineQueries: StoryOutlineQueryService;
  readonly canonicalWrites: NovelCanonicalWritePort;
  readonly identityFactory: {
    createStoryOutlineId(): StoryOutlineId;
    createStoryUnitId(): StoryUnitId;
    createOperationId(): NovelOperationId;
  };
  readonly orderKeys?: OrderKeyFactory;
  readonly logger?: Logger;
}
import { ToolError } from "../../../runtime/tools/execution/index.js";

const ITEM_REJECTION = {
  notFound: "not_found",
  duplicateId: "duplicate_id",
  unknownParent: "unknown_parent",
  invalidOrderKey: "invalid_order_key",
  notLeaf: "not_leaf",
  settingModeRequired: "setting_mode_required",
  invalidValue: "invalid_value",
  preconditionFailed: "precondition_failed",
} as const;

export class OutlineToolService {
  private readonly logger: Logger;
  private readonly orderKeys: OrderKeyFactory;

  constructor(private readonly options: OutlineToolServiceOptions) {
    this.logger = (options.logger ?? noopLogger).child({
      component: "novel_outline_tool_service",
    });
    this.orderKeys = options.orderKeys ?? new FractionalOrderKeyFactory();
  }

  async read(
    conversationId: string,
    arguments_: NovelOutlineReadArguments,
  ): Promise<NovelOutlineReadDetails> {
    const scope = canonicalNovelReadScope;
    const revision = await this.options.canonicalWrites.getCurrentRevision();
    const outline = await this.options.outlineQueries.getOutline(scope);
    if (outline === undefined) {
      return { units: [], revision: { currentRevision: revision } };
    }
    const tree = await this.options.outlineQueries.getTree(scope);
    if (tree === undefined) {
      return {
        outline: { id: outline.id, novelId: outline.novelId },
        units: [],
        revision: { currentRevision: revision },
      };
    }
    const selected =
      arguments_.storyUnitId === undefined
        ? tree.listDepthFirst()
        : [tree.getUnit(captureStoryUnitId(arguments_.storyUnitId))]
            .filter((unit): unit is StoryUnit => unit !== undefined);
    const units: NovelOutlineUnitDetails[] = [];
    for (const unit of selected) {
      const entry: NovelOutlineUnitDetails = {
        id: unit.id,
        outlineId: unit.outlineId,
        ...(unit.parentId === undefined ? {} : { parentId: unit.parentId }),
        orderKey: unit.orderKey,
        title: unit.title,
        ...(unit.intent === undefined ? {} : { intent: unit.intent }),
        ...(unit.synopsis === undefined ? {} : { synopsis: unit.synopsis }),
        ...(unit.scope === undefined ? {} : { scope: unit.scope }),
        planningStatus: unit.planningStatus,
        realizationStatus: unit.realizationStatus,
        ...(unit.blockState === undefined
          ? {}
          : {
              blockState: {
                ...(unit.blockState.reasonCode === undefined
                  ? {}
                  : { reasonCode: unit.blockState.reasonCode }),
                ...(unit.blockState.note === undefined
                  ? {}
                  : { note: unit.blockState.note }),
                dependencyIds: [...unit.blockState.dependencyIds],
                blockedAt: unit.blockState.blockedAt,
              },
            }),
        ...(unit.abandonment === undefined
          ? {}
          : {
              abandonment: {
                ...(unit.abandonment.reasonCode === undefined
                  ? {}
                  : { reasonCode: unit.abandonment.reasonCode }),
                ...(unit.abandonment.note === undefined
                  ? {}
                  : { note: unit.abandonment.note }),
                ...(unit.abandonment.replacementStoryUnitId === undefined
                  ? {}
                  : {
                      replacementStoryUnitId:
                        unit.abandonment.replacementStoryUnitId,
                    }),
                abandonedAt: unit.abandonment.abandonedAt,
              },
            }),
      };
      if (arguments_.includePlans === true) {
        const plan = await this.options.outlineQueries.getLeafStoryUnitPlan(
          scope,
          unit.id,
        );
        if (plan !== undefined) {
          entry.plan = toLeafPlanToolValue(plan.plan);
        }
      }
      const progress = tree.getProgress(unit.id);
      if (progress !== undefined) {
        entry.progress = {
          effectiveStatus: progress.effectiveStatus,
          isBlocked: progress.isBlocked,
          completedLeafCount: progress.completedLeafCount,
          totalLeafCount: progress.totalLeafCount,
        };
      }
      units.push(entry);
    }
    return {
      outline: { id: outline.id, novelId: outline.novelId },
      units,
      revision: { currentRevision: revision },
    };
  }

  async write(
    conversationId: string,
    arguments_: NovelOutlineWriteArguments,
  ): Promise<NovelOutlineWriteDetails> {
    const scope = canonicalNovelReadScope;
    const currentRevision =
      await this.options.canonicalWrites.getCurrentRevision();
    const baseRevision =
      arguments_.baseRevision === undefined
        ? undefined
        : captureNovelRevision(arguments_.baseRevision);
    const outline = await this.options.outlineQueries.getOutline(scope);
    const tree = await this.options.outlineQueries.getTree(scope);
    const operations: NovelOperation[] = [];
    const createdIds = new Set<string>();
    const items: NovelOutlineItemDetails[] = [];
    const outlineId =
      outline === undefined ? this.appendOutlineCreate(operations) : outline.id;
    this.logger.info("novel_outline_tool.write.started", {
      conversationId,
      requestedCount: arguments_.values.length,
    });
    for (const value of arguments_.values) {
      const storyUnitId = captureStoryUnitId(
        value.id ?? this.options.identityFactory.createStoryUnitId(),
      );
      try {
        this.appendWriteOperations({
          outlineId,
          tree,
          value,
          storyUnitId,
          operations,
          createdIds,
        });
        createdIds.add(storyUnitId);
        items.push({ id: storyUnitId, status: "applied" });
      } catch (error) {
        const reason = mapItemError(error);
        if (reason === undefined) {
          throw new ToolError({
            code: "NOVEL_OUTLINE_WRITE_FAILED",
            category: "execution",
            retryable: true,
            sideEffectStatus: "none",
            conversationId,
          });
        }
        // 2A：任一校验失败整批拒绝，不提交任何操作。
        this.logger.info("novel_outline_tool.write.rejected_batch", {
          conversationId,
          reason,
        });
        return {
          items: [{ id: storyUnitId, status: "rejected", reason }],
          revision: { currentRevision },
        };
      }
    }
    if (operations.length === 0) {
      return { items, revision: { currentRevision } };
    }
    try {
      const result = await this.options.canonicalWrites.applyOperations({
        operations,
        conversationId,
        ...(baseRevision === undefined ? {} : { baseRevision }),
      });
      this.logger.info("novel_outline_tool.write.completed", {
        conversationId,
        appliedCount: items.length,
        resultRevision: result.resultRevision,
      });
      return { items, revision: { currentRevision: result.resultRevision } };
    } catch (error) {
      this.logger.info("novel_outline_tool.write.failed", {
        conversationId,
        errorName: error instanceof Error ? error.name : typeof error,
      });
      throw new ToolError({
        code: "NOVEL_OUTLINE_WRITE_FAILED",
        category: "execution",
        retryable: true,
        sideEffectStatus: "none",
        conversationId,
      });
    }
  }

  async edit(
    conversationId: string,
    arguments_: NovelOutlineEditArguments,
  ): Promise<NovelOutlineWriteDetails> {
    const scope = canonicalNovelReadScope;
    const currentRevision =
      await this.options.canonicalWrites.getCurrentRevision();
    const baseRevision =
      arguments_.baseRevision === undefined
        ? undefined
        : captureNovelRevision(arguments_.baseRevision);
    const operations: NovelOperation[] = [];
    const items: NovelOutlineItemDetails[] = [];
    this.logger.info("novel_outline_tool.edit.started", {
      conversationId,
      requestedCount: arguments_.values.length,
    });
    for (const patch of arguments_.values) {
      try {
        await this.appendEditOperations({
          scope,
          id: patch.id,
          patch: patch.value,
          operations,
        });
        items.push({ id: patch.id, status: "applied" });
      } catch (error) {
        const reason = mapItemError(error);
        if (reason === undefined) {
          throw new ToolError({
            code: "NOVEL_OUTLINE_EDIT_FAILED",
            category: "execution",
            retryable: true,
            sideEffectStatus: "none",
            conversationId,
          });
        }
        // 2A：任一校验失败整批拒绝，不提交任何操作。
        this.logger.info("novel_outline_tool.edit.rejected_batch", {
          conversationId,
          reason,
        });
        return {
          items: [{ id: patch.id, status: "rejected", reason }],
          revision: { currentRevision },
        };
      }
    }
    if (operations.length === 0) {
      return { items, revision: { currentRevision } };
    }
    try {
      const result = await this.options.canonicalWrites.applyOperations({
        operations,
        conversationId,
        ...(baseRevision === undefined ? {} : { baseRevision }),
      });
      this.logger.info("novel_outline_tool.edit.completed", {
        conversationId,
        appliedCount: items.length,
        resultRevision: result.resultRevision,
      });
      return { items, revision: { currentRevision: result.resultRevision } };
    } catch (error) {
      this.logger.info("novel_outline_tool.edit.failed", {
        conversationId,
        errorName: error instanceof Error ? error.name : typeof error,
      });
      throw new ToolError({
        code: "NOVEL_OUTLINE_EDIT_FAILED",
        category: "execution",
        retryable: true,
        sideEffectStatus: "none",
        conversationId,
      });
    }
  }

  /** 收集一次批量写操作（校验 + 构造），不执行；调用方统一在一个事务中提交。 */
  private appendWriteOperations(input: {
    readonly outlineId: StoryOutlineId;
    readonly tree: StoryOutlineTree | undefined;
    readonly value: StoryUnitWriteValue;
    readonly storyUnitId: StoryUnitId;
    readonly operations: NovelOperation[];
    readonly createdIds: Set<string>;
  }): void {
    const { outlineId, tree, value, storyUnitId, operations, createdIds } =
      input;
    if (
      tree !== undefined &&
      tree.getUnit(storyUnitId) !== undefined
    ) {
      throw new NovelOutlineItemFailure(ITEM_REJECTION.duplicateId);
    }
    if (
      value.parentId !== undefined &&
      (tree === undefined ||
        tree.getUnit(captureStoryUnitId(value.parentId)) === undefined) &&
      !createdIds.has(value.parentId)
    ) {
      throw new NovelOutlineItemFailure(ITEM_REJECTION.unknownParent);
    }
    const orderKey = this.resolveWriteOrderKey(
      tree,
      value.parentId,
      value.orderKey,
    );
    const unit = captureStoryUnit({
      id: storyUnitId,
      outlineId,
      ...(value.parentId === undefined
        ? {}
        : { parentId: captureStoryUnitId(value.parentId) }),
      orderKey,
      title: value.title,
      ...(value.intent === undefined ? {} : { intent: value.intent }),
      ...(value.synopsis === undefined ? {} : { synopsis: value.synopsis }),
      ...(value.scope === undefined ? {} : { scope: value.scope }),
      planningStatus: value.planningStatus ?? "idea",
      realizationStatus: value.realizationStatus ?? "pending",
      ...(value.blockState === undefined
        ? {}
        : { blockState: captureBlockState(value.blockState) }),
      ...(value.abandonment === undefined
        ? {}
        : { abandonment: captureAbandonment(value.abandonment) }),
    });
    operations.push(
      createStoryUnitCreateOperation({
        operationId: this.options.identityFactory.createOperationId(),
        storyUnit: unit,
      }),
    );
    if (value.leaf !== undefined) {
      const plan = buildPlanFromWrite(value.leaf, unit.id);
      operations.push(
        createLeafStoryUnitPlanReplaceOperation({
          operationId: this.options.identityFactory.createOperationId(),
          plan,
        }),
      );
    }
  }

  /** 收集 outline 创建操作并返回新 outline id。Appends outline create and returns its id. */
  private appendOutlineCreate(
    operations: NovelOperation[],
  ): StoryOutlineId {
    const outlineId = this.options.identityFactory.createStoryOutlineId();
    operations.push(
      createStoryOutlineCreateOperation({
        operationId: this.options.identityFactory.createOperationId(),
        outline: { id: outlineId, novelId: this.options.novelId },
      }),
    );
    return outlineId;
  }

  /** 收集一次批量编辑操作（校验 + 构造），不执行；调用方统一在一个事务中提交。 */
  private async appendEditOperations(input: {
    readonly scope: NovelReadScope;
    readonly id: string;
    readonly patch: NovelOutlineEditValue;
    readonly operations: NovelOperation[];
  }): Promise<void> {
    const id = captureStoryUnitId(input.id);
    const current = await this.options.outlineQueries.getStoryUnit(
      input.scope,
      id,
    );
    if (current === undefined) {
      throw new NovelOutlineItemFailure(ITEM_REJECTION.notFound);
    }
    const unit = current.unit;
    const mergedContent = mergeContent(unit, input.patch);
    if (
      canonicalStringifyJson(mergedContent as unknown as JsonValue) !==
      canonicalStringifyJson(unitContent(unit) as unknown as JsonValue)
    ) {
      input.operations.push(
        createStoryUnitReplaceOperation({
          operationId: this.options.identityFactory.createOperationId(),
          storyUnitId: id,
          expectedContentDigest: current.contentDigest,
          content: mergedContent,
        }),
      );
    }
    const parentChanged =
      input.patch.parentId !== undefined &&
      (input.patch.parentId === null ? undefined : input.patch.parentId) !==
        unit.parentId;
    const orderChanged =
      input.patch.orderKey !== undefined &&
      input.patch.orderKey !== unit.orderKey;
    if (parentChanged || orderChanged) {
      const targetParent =
        input.patch.parentId === null
          ? undefined
          : (input.patch.parentId ?? unit.parentId);
      if (
        targetParent !== undefined &&
        (await this.options.outlineQueries.getStoryUnit(
          input.scope,
          captureStoryUnitId(targetParent),
        )) === undefined
      ) {
        throw new NovelOutlineItemFailure(ITEM_REJECTION.unknownParent);
      }
      const orderKey =
        input.patch.orderKey === undefined
          ? await this.appendOrderKey(input.scope, targetParent)
          : this.captureUnitOrderKey(input.patch.orderKey);
      input.operations.push(
        createStoryUnitMoveOperation({
          operationId: this.options.identityFactory.createOperationId(),
          storyUnitId: id,
          expectedParentDigest: current.parentDigest,
          expectedOrderDigest: current.orderDigest,
          ...(targetParent === undefined
            ? {}
            : { parentId: captureStoryUnitId(targetParent) }),
          orderKey,
        }),
      );
    }
    if (input.patch.leaf === null) {
      const plan = await this.options.outlineQueries.getLeafStoryUnitPlan(
        input.scope,
        id,
      );
      if (plan !== undefined) {
        input.operations.push(
          createLeafStoryUnitPlanClearOperation({
            operationId: this.options.identityFactory.createOperationId(),
            storyUnitId: id,
            expectedPlanDigest: plan.planDigest,
          }),
        );
      }
    } else if (input.patch.leaf !== undefined) {
      const tree = await this.options.outlineQueries.getTree(input.scope);
      if (tree !== undefined && tree.listChildren(id).length > 0) {
        throw new NovelOutlineItemFailure(ITEM_REJECTION.notLeaf);
      }
      const currentPlan =
        await this.options.outlineQueries.getLeafStoryUnitPlan(
          input.scope,
          id,
        );
      const mergedPlan = mergePlan(currentPlan?.plan, input.patch.leaf, id);
      if (
        currentPlan === undefined ||
        canonicalStringifyJson(mergedPlan as unknown as JsonValue) !==
          canonicalStringifyJson(currentPlan.plan as unknown as JsonValue)
      ) {
        input.operations.push(
          createLeafStoryUnitPlanReplaceOperation({
            operationId: this.options.identityFactory.createOperationId(),
            plan: mergedPlan,
            ...(currentPlan === undefined
              ? {}
              : { expectedPlanDigest: currentPlan.planDigest }),
          }),
        );
      }
    }
  }

  private resolveWriteOrderKey(
    tree: StoryOutlineTree | undefined,
    parentId: string | undefined,
    provided: string | undefined,
  ): OrderKey {
    if (provided !== undefined) {
      return this.captureUnitOrderKey(provided);
    }
    const siblings =
      tree === undefined
        ? []
        : parentId === undefined
          ? tree.listRoots()
          : tree.listChildren(captureStoryUnitId(parentId));
    const last = siblings.at(-1);
    return last === undefined
      ? this.orderKeys.initial()
      : this.orderKeys.after(last.orderKey);
  }

  private async appendOrderKey(
    scope: NovelReadScope,
    parentId: string | undefined,
  ): Promise<OrderKey> {
    const tree = await this.options.outlineQueries.getTree(scope);
    const siblings =
      tree === undefined
        ? []
        : parentId === undefined
          ? tree.listRoots()
          : tree.listChildren(captureStoryUnitId(parentId));
    const last = siblings.at(-1);
    return last === undefined
      ? this.orderKeys.initial()
      : this.orderKeys.after(last.orderKey);
  }

  private captureUnitOrderKey(value: string): OrderKey {
    try {
      return captureOrderKey(value);
    } catch {
      throw new NovelOutlineItemFailure(ITEM_REJECTION.invalidOrderKey);
    }
  }

}

class NovelOutlineItemFailure extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "NovelOutlineItemFailure";
  }
}

function rejectedItem(
  id: string,
  reason: string,
): NovelOutlineItemDetails {
  return Object.freeze({ id, status: "rejected", reason });
}

function mapItemError(error: unknown): string | undefined {
  if (error instanceof NovelOutlineItemFailure) return error.reason;
  if (error instanceof NovelProtocolValidationError) {
    return ITEM_REJECTION.invalidValue;
  }
  if (error instanceof NovelOperationPreconditionError) {
    return ITEM_REJECTION.preconditionFailed;
  }
  return undefined;
}

function unitContent(unit: StoryUnit): StoryUnitContent {
  return Object.freeze({
    title: unit.title,
    ...(unit.intent === undefined ? {} : { intent: unit.intent }),
    ...(unit.synopsis === undefined ? {} : { synopsis: unit.synopsis }),
    ...(unit.scope === undefined ? {} : { scope: unit.scope }),
    planningStatus: unit.planningStatus,
    realizationStatus: unit.realizationStatus,
    ...(unit.blockState === undefined ? {} : { blockState: unit.blockState }),
    ...(unit.abandonment === undefined
      ? {}
      : { abandonment: unit.abandonment }),
  });
}

function mergeContent(
  unit: StoryUnit,
  patch: NovelOutlineEditValue,
): StoryUnitContent {
  return captureStoryUnitContent({
    title: patch.title ?? unit.title,
    ...mergeOptionalString("intent", unit.intent, patch.intent),
    ...mergeOptionalString("synopsis", unit.synopsis, patch.synopsis),
    ...(patch.scope === undefined
      ? unit.scope === undefined
        ? {}
        : { scope: unit.scope }
      : patch.scope === null
        ? {}
        : { scope: patch.scope }),
    planningStatus: patch.planningStatus ?? unit.planningStatus,
    realizationStatus: patch.realizationStatus ?? unit.realizationStatus,
    ...(patch.blockState === undefined
      ? unit.blockState === undefined
        ? {}
        : { blockState: unit.blockState }
      : patch.blockState === null
        ? {}
        : { blockState: captureBlockState(patch.blockState) }),
    ...(patch.abandonment === undefined
      ? unit.abandonment === undefined
        ? {}
        : { abandonment: unit.abandonment }
      : patch.abandonment === null
        ? {}
        : { abandonment: captureAbandonment(patch.abandonment) }),
  });
}

function mergeOptionalString(
  field: "intent" | "synopsis",
  current: string | undefined,
  patch: string | null | undefined,
): Partial<StoryUnitContent> {
  if (patch === undefined) {
    return current === undefined ? {} : { [field]: current };
  }
  if (patch === null) return {};
  return { [field]: patch };
}

function captureBlockState(
  value: NonNullable<NovelOutlineEditValue["blockState"]>,
): {
  reasonCode?: StoryUnitBlockState["reasonCode"];
  note?: string;
  dependencyIds: StoryUnitId[];
  blockedAt: string;
} {
  return {
    ...(value.reasonCode === undefined ? {} : { reasonCode: value.reasonCode }),
    ...(value.note === undefined ? {} : { note: value.note }),
    dependencyIds: value.dependencyIds.map(captureStoryUnitId),
    blockedAt: value.blockedAt,
  };
}

function captureAbandonment(
  value: NonNullable<NovelOutlineEditValue["abandonment"]>,
): {
  reasonCode?: StoryUnitAbandonment["reasonCode"];
  note?: string;
  replacementStoryUnitId?: StoryUnitId;
  abandonedAt: string;
} {
  return {
    ...(value.reasonCode === undefined ? {} : { reasonCode: value.reasonCode }),
    ...(value.note === undefined ? {} : { note: value.note }),
    ...(value.replacementStoryUnitId === undefined
      ? {}
      : { replacementStoryUnitId: captureStoryUnitId(value.replacementStoryUnitId) }),
    abandonedAt: value.abandonedAt,
  };
}

function mergePlan(
  current: LeafStoryUnitPlan | undefined,
  patch: NonNullable<NovelOutlineEditValue["leaf"]>,
  storyUnitId: StoryUnitId,
): LeafStoryUnitPlan {
  const base = current === undefined ? undefined : toLeafPlanWriteValue(current);
  const settingMode = patch.settingMode ?? base?.settingMode;
  if (settingMode === undefined) {
    throw new NovelOutlineItemFailure(ITEM_REJECTION.settingModeRequired);
  }
  return buildPlanFromWrite(
    {
      settingMode,
      ...(patch.time === undefined
        ? base?.time === undefined
          ? {}
          : { time: base.time }
        : patch.time === null
          ? {}
          : { time: patch.time }),
      characters:
        patch.characters === undefined
          ? (base?.characters ?? [])
          : patch.characters === null
            ? []
            : patch.characters,
      locations:
        patch.locations === undefined
          ? (base?.locations ?? [])
          : patch.locations === null
            ? []
            : patch.locations,
      events:
        patch.events === undefined
          ? (base?.events ?? [])
          : patch.events === null
            ? []
            : patch.events,
      rhythmBeats:
        patch.rhythmBeats === undefined
          ? (base?.rhythmBeats ?? [])
          : patch.rhythmBeats === null
            ? []
            : patch.rhythmBeats,
      entityChanges:
        patch.entityChanges === undefined
          ? (base?.entityChanges ?? [])
          : patch.entityChanges === null
            ? []
            : patch.entityChanges,
    },
    storyUnitId,
  );
}

function buildPlanFromWrite(
  leaf: LeafPlanWriteValue,
  storyUnitId: StoryUnitId,
): LeafStoryUnitPlan {
  return captureLeafStoryUnitPlan({
    storyUnitId,
    settingMode: leaf.settingMode,
    ...(leaf.time === undefined ? {} : { time: leaf.time }),
    characters: leaf.characters.map((binding) => ({
      storyUnitId,
      characterId: captureCharacterId(binding.characterId),
      ...(binding.involvement === undefined
        ? {}
        : {
            involvement: {
              presence: binding.involvement.presence,
              roles: [...binding.involvement.roles],
            },
          }),
      ...(binding.note === undefined ? {} : { note: binding.note }),
    })),
    locations: leaf.locations.map((binding) => ({
      storyUnitId,
      locationId: captureLocationId(binding.locationId),
      ...(binding.involvement === undefined
        ? {}
        : { involvement: binding.involvement }),
      ...(binding.note === undefined ? {} : { note: binding.note }),
    })),
    events: leaf.events.map((event) => ({
      id: captureStoryEventStepId(event.id),
      storyUnitId,
      orderKey: captureOrderKey(event.orderKey),
      description: event.description,
    })),
    rhythmBeats: leaf.rhythmBeats.map((beat) => ({
      id: captureRhythmBeatId(beat.id),
      storyUnitId,
      orderKey: captureOrderKey(beat.orderKey),
      rhythm: beat.rhythm,
      intensity: beat.intensity,
      ...(beat.readerEmotion === undefined
        ? {}
        : { readerEmotion: beat.readerEmotion }),
      ...(beat.pointOfViewEmotion === undefined
        ? {}
        : { pointOfViewEmotion: beat.pointOfViewEmotion }),
      ...(beat.description === undefined ? {} : { description: beat.description }),
      relatedEventIds: beat.relatedEventIds.map(captureStoryEventStepId),
    })),
    entityChanges: leaf.entityChanges.map((change) => ({
      id: captureStoryUnitEntityChangeId(change.id),
      storyUnitId,
      entityType: change.entityType,
      entityId:
        change.entityType === "character"
          ? captureCharacterId(change.entityId)
          : captureLocationId(change.entityId),
      ...(change.relatedEntityId === undefined
        ? {}
        : { relatedEntityId: captureStoryEntityId(change.relatedEntityId) }),
      category: change.category,
      summary: change.summary,
      sourceEventIds: change.sourceEventIds.map(captureStoryEventStepId),
    })),
  });
}

function toLeafPlanWriteValue(plan: LeafStoryUnitPlan): LeafPlanWriteValue {
  return toLeafPlanToolValue(plan) as unknown as LeafPlanWriteValue;
}

function toLeafPlanToolValue(plan: LeafStoryUnitPlan): LeafPlanToolValue {
  return {
    settingMode: plan.settingMode,
    ...(plan.time === undefined ? {} : { time: plan.time }),
    characters: plan.characters.map((binding) => ({
      characterId: binding.characterId,
      ...(binding.involvement === undefined
        ? {}
        : {
            involvement: {
              presence: binding.involvement.presence,
              roles: [...binding.involvement.roles],
            },
          }),
      ...(binding.note === undefined ? {} : { note: binding.note }),
    })),
    locations: plan.locations.map((binding) => ({
      locationId: binding.locationId,
      ...(binding.involvement === undefined
        ? {}
        : { involvement: binding.involvement }),
      ...(binding.note === undefined ? {} : { note: binding.note }),
    })),
    events: plan.events.map((event) => ({
      id: event.id,
      orderKey: event.orderKey,
      description: event.description,
    })),
    rhythmBeats: plan.rhythmBeats.map((beat) => ({
      id: beat.id,
      orderKey: beat.orderKey,
      rhythm: beat.rhythm,
      intensity: beat.intensity,
      ...(beat.readerEmotion === undefined
        ? {}
        : { readerEmotion: beat.readerEmotion }),
      ...(beat.pointOfViewEmotion === undefined
        ? {}
        : { pointOfViewEmotion: beat.pointOfViewEmotion }),
      ...(beat.description === undefined
        ? {}
        : { description: beat.description }),
      relatedEventIds: [...beat.relatedEventIds],
    })),
    entityChanges: plan.entityChanges.map((change) => ({
      id: change.id,
      entityType: change.entityType,
      entityId: change.entityId,
      ...(change.relatedEntityId === undefined
        ? {}
        : { relatedEntityId: change.relatedEntityId }),
      category: change.category,
      summary: change.summary,
      sourceEventIds: [...change.sourceEventIds],
    })),
  };
}
