/** Versioned deterministic Manuscript structural Operations and synchronous handlers. */
import {
  canonicalStringifyJson,
  type JsonObject,
} from "../../../event/index.js";
import {
  NovelOperationPreconditionError,
  NOVEL_PROTOCOL_FAILURE,
  NovelProtocolValidationError,
} from "../../error/index.js";
import {
  captureManuscriptBlockId,
  captureManuscriptId,
  capturePublicationChapterId,
  type ManuscriptBlockId,
  type ManuscriptId,
  type NovelOperationId,
  type PublicationChapterId,
} from "../../identity/index.js";
import {
  MANUSCRIPT_ANCHOR_BOUNDARY,
  MANUSCRIPT_REDIRECT_REASON,
  MANUSCRIPT_REPAIR_REVIEW,
  MANUSCRIPT_TOMBSTONE_REASON,
  captureManuscriptAnchor,
  captureManuscriptAnchorRedirect,
  captureManuscriptBlockTombstone,
  captureManuscriptText,
  captureManuscript,
  captureParagraphBlock,
  captureOrderKey,
  compareOrderKeys,
  manuscriptAnchorKey,
  type ManuscriptAnchor,
  type Manuscript,
  type OrderKey,
  type ParagraphBlock,
} from "../../model/index.js";
import type {
  ManuscriptBlockDigestField,
  NovelManuscriptMutationContext,
  NovelMutableManuscriptRepository,
} from "../../port/index.js";
import { captureNovelOperationVersion } from "../../version/index.js";
import {
  captureNovelOperation,
  type NovelOperation,
  type NovelOperationPrecondition,
} from "../NovelOperation.js";
import type { NovelOperationRegistry } from "../NovelOperationRegistry.js";

export const NOVEL_MANUSCRIPT_OPERATION_TYPE = {
  manuscriptCreate: "manuscript.create",
  blockCreate: "manuscript-block.create",
  blockTextReplace: "manuscript-block.text.replace",
  blockMove: "manuscript-block.move",
  blockSplit: "manuscript-block.split",
  blockMerge: "manuscript-block.merge",
  blockDelete: "manuscript-block.delete",
  anchorRepair: "manuscript-anchor.repair",
} as const;

const MANUSCRIPT_OPERATION_VERSION = captureNovelOperationVersion(1);
const MANUSCRIPT_ENTITY_TYPE = "manuscript";
const MANUSCRIPT_NOVEL_ENTITY_TYPE = "manuscript-for-novel";
const PUBLICATION_ENTITY_TYPE = "publication";
const BLOCK_ENTITY_TYPE = "manuscript-block";
const TOMBSTONE_ENTITY_TYPE = "manuscript-tombstone";
const REDIRECT_ENTITY_TYPE = "manuscript-anchor-redirect";
const CHAPTER_ENTITY_TYPE = "publication-chapter";

interface BlockMovePayload extends JsonObject {
  readonly blockId: string;
  readonly chapterId: string;
  readonly orderKey: string;
}

interface ManuscriptPayload extends JsonObject {
  readonly manuscript: JsonObject;
}

interface BlockPayload extends JsonObject {
  readonly block: JsonObject;
}

interface BlockTextReplacePayload extends JsonObject {
  readonly blockId: string;
  readonly text: string;
}

export function createManuscriptCreateOperation(input: {
  readonly operationId: NovelOperationId;
  readonly manuscript: Manuscript;
}): NovelOperation<
  typeof NOVEL_MANUSCRIPT_OPERATION_TYPE.manuscriptCreate,
  ManuscriptPayload
> {
  const manuscript = captureManuscript(input.manuscript);
  return captureNovelOperation({
    operationId: input.operationId,
    operationVersion: MANUSCRIPT_OPERATION_VERSION,
    type: NOVEL_MANUSCRIPT_OPERATION_TYPE.manuscriptCreate,
    expected: [
      absent(MANUSCRIPT_ENTITY_TYPE, manuscript.id),
      absent(MANUSCRIPT_NOVEL_ENTITY_TYPE, manuscript.novelId),
      exists(PUBLICATION_ENTITY_TYPE, manuscript.publicationId),
    ],
    payload: { manuscript: toJsonObject(manuscript) },
  });
}

export function createManuscriptBlockCreateOperation(input: {
  readonly operationId: NovelOperationId;
  readonly block: ParagraphBlock;
}): NovelOperation<
  typeof NOVEL_MANUSCRIPT_OPERATION_TYPE.blockCreate,
  BlockPayload
> {
  const block = captureParagraphBlock(input.block);
  return captureNovelOperation({
    operationId: input.operationId,
    operationVersion: MANUSCRIPT_OPERATION_VERSION,
    type: NOVEL_MANUSCRIPT_OPERATION_TYPE.blockCreate,
    expected: [
      exists(MANUSCRIPT_ENTITY_TYPE, block.manuscriptId),
      exists(CHAPTER_ENTITY_TYPE, block.chapterId),
      absent(BLOCK_ENTITY_TYPE, block.id),
      absent(TOMBSTONE_ENTITY_TYPE, block.id),
    ],
    payload: { block: toJsonObject(block) },
  });
}

export function createManuscriptBlockTextReplaceOperation(input: {
  readonly operationId: NovelOperationId;
  readonly blockId: ManuscriptBlockId;
  readonly expectedTextDigest: string;
  readonly text: string;
}): NovelOperation<
  typeof NOVEL_MANUSCRIPT_OPERATION_TYPE.blockTextReplace,
  BlockTextReplacePayload
> {
  const blockId = captureManuscriptBlockId(input.blockId);
  return captureNovelOperation({
    operationId: input.operationId,
    operationVersion: MANUSCRIPT_OPERATION_VERSION,
    type: NOVEL_MANUSCRIPT_OPERATION_TYPE.blockTextReplace,
    expected: [
      exists(BLOCK_ENTITY_TYPE, blockId),
      fieldDigest(BLOCK_ENTITY_TYPE, blockId, "text", input.expectedTextDigest),
    ],
    payload: { blockId, text: captureManuscriptText(input.text) },
  });
}

interface BlockSplitPayload extends JsonObject {
  readonly blockId: string;
  readonly leftText: string;
  readonly rightBlock: JsonObject;
}

interface BlockMergePayload extends JsonObject {
  readonly leftBlockId: string;
  readonly rightBlockId: string;
  readonly text: string;
}

interface BlockDeletePayload extends JsonObject {
  readonly blockId: string;
}

interface AnchorRepairPayload extends JsonObject {
  readonly source: JsonObject;
  readonly target: JsonObject;
}

export function createManuscriptBlockMoveOperation(input: {
  readonly operationId: NovelOperationId;
  readonly blockId: ManuscriptBlockId;
  readonly expectedChapterDigest: string;
  readonly expectedOrderDigest: string;
  readonly chapterId: PublicationChapterId;
  readonly orderKey: OrderKey;
}): NovelOperation<
  typeof NOVEL_MANUSCRIPT_OPERATION_TYPE.blockMove,
  BlockMovePayload
> {
  const blockId = captureManuscriptBlockId(input.blockId);
  const chapterId = capturePublicationChapterId(input.chapterId);
  const orderKey = captureOrderKey(input.orderKey);
  return captureNovelOperation({
    operationId: input.operationId,
    operationVersion: MANUSCRIPT_OPERATION_VERSION,
    type: NOVEL_MANUSCRIPT_OPERATION_TYPE.blockMove,
    expected: [
      exists(BLOCK_ENTITY_TYPE, blockId),
      fieldDigest(BLOCK_ENTITY_TYPE, blockId, "chapterId", input.expectedChapterDigest),
      fieldDigest(BLOCK_ENTITY_TYPE, blockId, "orderKey", input.expectedOrderDigest),
      exists(CHAPTER_ENTITY_TYPE, chapterId),
    ],
    payload: { blockId, chapterId, orderKey },
  });
}

export function createManuscriptBlockSplitOperation(input: {
  readonly operationId: NovelOperationId;
  readonly blockId: ManuscriptBlockId;
  readonly expectedTextDigest: string;
  readonly leftText: string;
  readonly rightBlock: ParagraphBlock;
}): NovelOperation<
  typeof NOVEL_MANUSCRIPT_OPERATION_TYPE.blockSplit,
  BlockSplitPayload
> {
  const blockId = captureManuscriptBlockId(input.blockId);
  const leftText = captureManuscriptText(input.leftText);
  const rightBlock = captureParagraphBlock(input.rightBlock);
  const sourceAfter = anchor(blockId, MANUSCRIPT_ANCHOR_BOUNDARY.after);
  return captureNovelOperation({
    operationId: input.operationId,
    operationVersion: MANUSCRIPT_OPERATION_VERSION,
    type: NOVEL_MANUSCRIPT_OPERATION_TYPE.blockSplit,
    expected: [
      exists(BLOCK_ENTITY_TYPE, blockId),
      fieldDigest(BLOCK_ENTITY_TYPE, blockId, "text", input.expectedTextDigest),
      absent(BLOCK_ENTITY_TYPE, rightBlock.id),
      absent(REDIRECT_ENTITY_TYPE, manuscriptAnchorKey(sourceAfter)),
    ],
    payload: { blockId, leftText, rightBlock: toJsonObject(rightBlock) },
  });
}

export function createManuscriptBlockMergeOperation(input: {
  readonly operationId: NovelOperationId;
  readonly leftBlockId: ManuscriptBlockId;
  readonly rightBlockId: ManuscriptBlockId;
  readonly expectedLeftTextDigest: string;
  readonly expectedRightTextDigest: string;
  readonly expectedLeftChapterDigest: string;
  readonly expectedRightChapterDigest: string;
  readonly expectedLeftOrderDigest: string;
  readonly expectedRightOrderDigest: string;
  readonly text: string;
}): NovelOperation<
  typeof NOVEL_MANUSCRIPT_OPERATION_TYPE.blockMerge,
  BlockMergePayload
> {
  const leftBlockId = captureManuscriptBlockId(input.leftBlockId);
  const rightBlockId = captureManuscriptBlockId(input.rightBlockId);
  if (leftBlockId === rightBlockId) throw invalidPayload();
  const leftAfter = anchor(leftBlockId, MANUSCRIPT_ANCHOR_BOUNDARY.after);
  const rightBefore = anchor(rightBlockId, MANUSCRIPT_ANCHOR_BOUNDARY.before);
  const rightAfter = anchor(rightBlockId, MANUSCRIPT_ANCHOR_BOUNDARY.after);
  return captureNovelOperation({
    operationId: input.operationId,
    operationVersion: MANUSCRIPT_OPERATION_VERSION,
    type: NOVEL_MANUSCRIPT_OPERATION_TYPE.blockMerge,
    expected: [
      exists(BLOCK_ENTITY_TYPE, leftBlockId),
      exists(BLOCK_ENTITY_TYPE, rightBlockId),
      fieldDigest(BLOCK_ENTITY_TYPE, leftBlockId, "text", input.expectedLeftTextDigest),
      fieldDigest(BLOCK_ENTITY_TYPE, rightBlockId, "text", input.expectedRightTextDigest),
      fieldDigest(BLOCK_ENTITY_TYPE, leftBlockId, "chapterId", input.expectedLeftChapterDigest),
      fieldDigest(BLOCK_ENTITY_TYPE, rightBlockId, "chapterId", input.expectedRightChapterDigest),
      fieldDigest(BLOCK_ENTITY_TYPE, leftBlockId, "orderKey", input.expectedLeftOrderDigest),
      fieldDigest(BLOCK_ENTITY_TYPE, rightBlockId, "orderKey", input.expectedRightOrderDigest),
      absent(TOMBSTONE_ENTITY_TYPE, rightBlockId),
      absent(REDIRECT_ENTITY_TYPE, manuscriptAnchorKey(leftAfter)),
      absent(REDIRECT_ENTITY_TYPE, manuscriptAnchorKey(rightBefore)),
      absent(REDIRECT_ENTITY_TYPE, manuscriptAnchorKey(rightAfter)),
    ],
    payload: {
      leftBlockId,
      rightBlockId,
      text: captureManuscriptText(input.text),
    },
  });
}

export function createManuscriptBlockDeleteOperation(input: {
  readonly operationId: NovelOperationId;
  readonly blockId: ManuscriptBlockId;
  readonly expectedTextDigest: string;
  readonly expectedChapterDigest: string;
  readonly expectedOrderDigest: string;
}): NovelOperation<
  typeof NOVEL_MANUSCRIPT_OPERATION_TYPE.blockDelete,
  BlockDeletePayload
> {
  const blockId = captureManuscriptBlockId(input.blockId);
  return captureNovelOperation({
    operationId: input.operationId,
    operationVersion: MANUSCRIPT_OPERATION_VERSION,
    type: NOVEL_MANUSCRIPT_OPERATION_TYPE.blockDelete,
    expected: [
      exists(BLOCK_ENTITY_TYPE, blockId),
      fieldDigest(BLOCK_ENTITY_TYPE, blockId, "text", input.expectedTextDigest),
      fieldDigest(BLOCK_ENTITY_TYPE, blockId, "chapterId", input.expectedChapterDigest),
      fieldDigest(BLOCK_ENTITY_TYPE, blockId, "orderKey", input.expectedOrderDigest),
      absent(TOMBSTONE_ENTITY_TYPE, blockId),
    ],
    payload: { blockId },
  });
}

export function createManuscriptAnchorRepairOperation(input: {
  readonly operationId: NovelOperationId;
  readonly source: ManuscriptAnchor;
  readonly target: ManuscriptAnchor;
}): NovelOperation<
  typeof NOVEL_MANUSCRIPT_OPERATION_TYPE.anchorRepair,
  AnchorRepairPayload
> {
  const source = captureManuscriptAnchor(input.source);
  const target = captureManuscriptAnchor(input.target);
  return captureNovelOperation({
    operationId: input.operationId,
    operationVersion: MANUSCRIPT_OPERATION_VERSION,
    type: NOVEL_MANUSCRIPT_OPERATION_TYPE.anchorRepair,
    expected: [
      exists(TOMBSTONE_ENTITY_TYPE, source.blockId),
      exists(BLOCK_ENTITY_TYPE, target.blockId),
      absent(REDIRECT_ENTITY_TYPE, manuscriptAnchorKey(source)),
    ],
    payload: { source: toJsonObject(source), target: toJsonObject(target) },
  });
}

export function registerNovelManuscriptOperationHandlers<
  TContext extends NovelManuscriptMutationContext,
>(registry: NovelOperationRegistry<TContext>): void {
  registry.register({
    operationType: NOVEL_MANUSCRIPT_OPERATION_TYPE.manuscriptCreate,
    operationVersion: MANUSCRIPT_OPERATION_VERSION,
    apply(context, operation) {
      applyManuscriptCreate(context.manuscript, operation);
    },
  });
  registry.register({
    operationType: NOVEL_MANUSCRIPT_OPERATION_TYPE.blockCreate,
    operationVersion: MANUSCRIPT_OPERATION_VERSION,
    apply(context, operation) {
      applyBlockCreate(context.manuscript, operation);
    },
  });
  registry.register({
    operationType: NOVEL_MANUSCRIPT_OPERATION_TYPE.blockTextReplace,
    operationVersion: MANUSCRIPT_OPERATION_VERSION,
    apply(context, operation) {
      applyBlockTextReplace(context.manuscript, operation);
    },
  });
  registry.register({
    operationType: NOVEL_MANUSCRIPT_OPERATION_TYPE.blockMove,
    operationVersion: MANUSCRIPT_OPERATION_VERSION,
    apply(context, operation) {
      applyBlockMove(context.manuscript, operation);
    },
  });
  registry.register({
    operationType: NOVEL_MANUSCRIPT_OPERATION_TYPE.blockSplit,
    operationVersion: MANUSCRIPT_OPERATION_VERSION,
    apply(context, operation) {
      applyBlockSplit(context.manuscript, operation);
    },
  });
  registry.register({
    operationType: NOVEL_MANUSCRIPT_OPERATION_TYPE.blockMerge,
    operationVersion: MANUSCRIPT_OPERATION_VERSION,
    apply(context, operation) {
      applyBlockMerge(context.manuscript, operation);
    },
  });
  registry.register({
    operationType: NOVEL_MANUSCRIPT_OPERATION_TYPE.blockDelete,
    operationVersion: MANUSCRIPT_OPERATION_VERSION,
    apply(context, operation) {
      applyBlockDelete(context.manuscript, operation);
    },
  });
  registry.register({
    operationType: NOVEL_MANUSCRIPT_OPERATION_TYPE.anchorRepair,
    operationVersion: MANUSCRIPT_OPERATION_VERSION,
    apply(context, operation) {
      applyAnchorRepair(context.manuscript, operation);
    },
  });
}

function applyManuscriptCreate(
  store: NovelMutableManuscriptRepository,
  operation: NovelOperation,
): void {
  const payload = capturePayloadObject(operation.payload, ["manuscript"]);
  const manuscript = captureManuscript(payload.manuscript);
  assertExpected(operation, [
    absent(MANUSCRIPT_ENTITY_TYPE, manuscript.id),
    absent(MANUSCRIPT_NOVEL_ENTITY_TYPE, manuscript.novelId),
    exists(PUBLICATION_ENTITY_TYPE, manuscript.publicationId),
  ]);
  if (store.getManuscript(manuscript.id) !== undefined) {
    throw precondition(operation, "entity_exists", MANUSCRIPT_ENTITY_TYPE, manuscript.id);
  }
  if (store.findManuscriptByNovelId(manuscript.novelId) !== undefined) {
    throw precondition(
      operation,
      "entity_exists",
      MANUSCRIPT_NOVEL_ENTITY_TYPE,
      manuscript.novelId,
    );
  }
  if (!store.hasPublication(manuscript.publicationId)) {
    throw precondition(
      operation,
      "entity_missing",
      PUBLICATION_ENTITY_TYPE,
      manuscript.publicationId,
    );
  }
  if (!store.insertManuscript(manuscript)) {
    throw precondition(operation, "domain_invariant", MANUSCRIPT_ENTITY_TYPE, manuscript.id);
  }
}

function applyBlockCreate(
  store: NovelMutableManuscriptRepository,
  operation: NovelOperation,
): void {
  const payload = capturePayloadObject(operation.payload, ["block"]);
  const block = captureParagraphBlock(payload.block);
  assertExpected(operation, [
    exists(MANUSCRIPT_ENTITY_TYPE, block.manuscriptId),
    exists(CHAPTER_ENTITY_TYPE, block.chapterId),
    absent(BLOCK_ENTITY_TYPE, block.id),
    absent(TOMBSTONE_ENTITY_TYPE, block.id),
  ]);
  requireManuscript(store, operation, block.manuscriptId);
  if (!store.hasPublicationChapter(block.chapterId)) {
    throw precondition(operation, "entity_missing", CHAPTER_ENTITY_TYPE, block.chapterId);
  }
  if (store.getBlock(block.id) !== undefined || store.getTombstone(block.id) !== undefined) {
    throw precondition(operation, "entity_exists", BLOCK_ENTITY_TYPE, block.id);
  }
  if (store.findBlockAt(block.manuscriptId, block.chapterId, block.orderKey) !== undefined) {
    throw precondition(operation, "domain_invariant", BLOCK_ENTITY_TYPE, block.id, "orderKey");
  }
  if (!store.insertBlock(block)) {
    throw precondition(operation, "domain_invariant", BLOCK_ENTITY_TYPE, block.id);
  }
}

function applyBlockTextReplace(
  store: NovelMutableManuscriptRepository,
  operation: NovelOperation,
): void {
  const payload = capturePayloadObject(operation.payload, ["blockId", "text"]);
  const blockId = captureManuscriptBlockId(payload.blockId);
  const text = captureManuscriptText(payload.text);
  assertExpected(operation, [
    exists(BLOCK_ENTITY_TYPE, blockId),
    fieldDigest(BLOCK_ENTITY_TYPE, blockId, "text", expectedDigest(operation, 1)),
  ]);
  const block = requireBlock(store, operation, blockId);
  assertBlockDigest(store, operation, blockId, "text");
  if (!store.replaceBlock(captureParagraphBlock({ ...block, text }))) {
    throw precondition(operation, "domain_invariant", BLOCK_ENTITY_TYPE, blockId);
  }
}

function requireManuscript(
  store: NovelMutableManuscriptRepository,
  operation: NovelOperation,
  id: ManuscriptId,
): Manuscript {
  const manuscript = store.getManuscript(id);
  if (manuscript === undefined) {
    throw precondition(operation, "entity_missing", MANUSCRIPT_ENTITY_TYPE, id);
  }
  return manuscript;
}

function applyBlockMove(
  store: NovelMutableManuscriptRepository,
  operation: NovelOperation,
): void {
  const payload = capturePayloadObject(operation.payload, [
    "blockId",
    "chapterId",
    "orderKey",
  ]);
  const blockId = captureManuscriptBlockId(payload.blockId);
  const chapterId = capturePublicationChapterId(payload.chapterId);
  const orderKey = captureOrderKey(payload.orderKey);
  assertExpected(operation, [
    exists(BLOCK_ENTITY_TYPE, blockId),
    fieldDigest(BLOCK_ENTITY_TYPE, blockId, "chapterId", expectedDigest(operation, 1)),
    fieldDigest(BLOCK_ENTITY_TYPE, blockId, "orderKey", expectedDigest(operation, 2)),
    exists(CHAPTER_ENTITY_TYPE, chapterId),
  ]);
  assertBlockDigest(store, operation, blockId, "chapterId");
  assertBlockDigest(store, operation, blockId, "orderKey");
  const block = requireBlock(store, operation, blockId);
  if (!store.hasPublicationChapter(chapterId)) {
    throw precondition(operation, "entity_missing", CHAPTER_ENTITY_TYPE, chapterId);
  }
  const occupant = store.findBlockAt(block.manuscriptId, chapterId, orderKey);
  if (occupant !== undefined && occupant.id !== block.id) {
    throw precondition(operation, "domain_invariant", BLOCK_ENTITY_TYPE, block.id);
  }
  if (!store.replaceBlock(captureParagraphBlock({ ...block, chapterId, orderKey }))) {
    throw precondition(operation, "domain_invariant", BLOCK_ENTITY_TYPE, block.id);
  }
}

function applyBlockSplit(
  store: NovelMutableManuscriptRepository,
  operation: NovelOperation,
): void {
  const payload = capturePayloadObject(operation.payload, [
    "blockId",
    "leftText",
    "rightBlock",
  ]);
  const blockId = captureManuscriptBlockId(payload.blockId);
  const leftText = captureManuscriptText(payload.leftText);
  const rightBlock = captureParagraphBlock(payload.rightBlock);
  const sourceAfter = anchor(blockId, MANUSCRIPT_ANCHOR_BOUNDARY.after);
  assertExpected(operation, [
    exists(BLOCK_ENTITY_TYPE, blockId),
    fieldDigest(BLOCK_ENTITY_TYPE, blockId, "text", expectedDigest(operation, 1)),
    absent(BLOCK_ENTITY_TYPE, rightBlock.id),
    absent(REDIRECT_ENTITY_TYPE, manuscriptAnchorKey(sourceAfter)),
  ]);
  assertBlockDigest(store, operation, blockId, "text");
  const source = requireBlock(store, operation, blockId);
  if (
    store.getBlock(rightBlock.id) !== undefined ||
    store.getAnchorRedirect(sourceAfter) !== undefined ||
    source.manuscriptId !== rightBlock.manuscriptId ||
    source.chapterId !== rightBlock.chapterId ||
    !isImmediateRightInsertion(store, source, rightBlock)
  ) {
    throw precondition(operation, "domain_invariant", BLOCK_ENTITY_TYPE, blockId);
  }
  const redirect = captureManuscriptAnchorRedirect({
    source: sourceAfter,
    target: anchor(rightBlock.id, MANUSCRIPT_ANCHOR_BOUNDARY.after),
    reason: MANUSCRIPT_REDIRECT_REASON.split,
    review: MANUSCRIPT_REPAIR_REVIEW.automatic,
  });
  if (
    !store.replaceBlock(captureParagraphBlock({ ...source, text: leftText })) ||
    !store.insertBlock(rightBlock) ||
    !store.insertAnchorRedirect(redirect)
  ) {
    throw precondition(operation, "domain_invariant", BLOCK_ENTITY_TYPE, blockId);
  }
}

function applyBlockMerge(
  store: NovelMutableManuscriptRepository,
  operation: NovelOperation,
): void {
  const payload = capturePayloadObject(operation.payload, [
    "leftBlockId",
    "rightBlockId",
    "text",
  ]);
  const leftBlockId = captureManuscriptBlockId(payload.leftBlockId);
  const rightBlockId = captureManuscriptBlockId(payload.rightBlockId);
  const text = captureManuscriptText(payload.text);
  const leftAfter = anchor(leftBlockId, MANUSCRIPT_ANCHOR_BOUNDARY.after);
  const rightBefore = anchor(rightBlockId, MANUSCRIPT_ANCHOR_BOUNDARY.before);
  const rightAfter = anchor(rightBlockId, MANUSCRIPT_ANCHOR_BOUNDARY.after);
  assertExpected(operation, [
    exists(BLOCK_ENTITY_TYPE, leftBlockId),
    exists(BLOCK_ENTITY_TYPE, rightBlockId),
    fieldDigest(BLOCK_ENTITY_TYPE, leftBlockId, "text", expectedDigest(operation, 2)),
    fieldDigest(BLOCK_ENTITY_TYPE, rightBlockId, "text", expectedDigest(operation, 3)),
    fieldDigest(BLOCK_ENTITY_TYPE, leftBlockId, "chapterId", expectedDigest(operation, 4)),
    fieldDigest(BLOCK_ENTITY_TYPE, rightBlockId, "chapterId", expectedDigest(operation, 5)),
    fieldDigest(BLOCK_ENTITY_TYPE, leftBlockId, "orderKey", expectedDigest(operation, 6)),
    fieldDigest(BLOCK_ENTITY_TYPE, rightBlockId, "orderKey", expectedDigest(operation, 7)),
    absent(TOMBSTONE_ENTITY_TYPE, rightBlockId),
    absent(REDIRECT_ENTITY_TYPE, manuscriptAnchorKey(leftAfter)),
    absent(REDIRECT_ENTITY_TYPE, manuscriptAnchorKey(rightBefore)),
    absent(REDIRECT_ENTITY_TYPE, manuscriptAnchorKey(rightAfter)),
  ]);
  for (const [id, field] of [
    [leftBlockId, "text"],
    [rightBlockId, "text"],
    [leftBlockId, "chapterId"],
    [rightBlockId, "chapterId"],
    [leftBlockId, "orderKey"],
    [rightBlockId, "orderKey"],
  ] as const) {
    assertBlockDigest(store, operation, id, field);
  }
  const left = requireBlock(store, operation, leftBlockId);
  const right = requireBlock(store, operation, rightBlockId);
  if (
    left.manuscriptId !== right.manuscriptId ||
    left.chapterId !== right.chapterId ||
    !areAdjacent(store, left, right) ||
    store.getTombstone(right.id) !== undefined ||
    store.getAnchorRedirect(leftAfter) !== undefined ||
    store.getAnchorRedirect(rightBefore) !== undefined ||
    store.getAnchorRedirect(rightAfter) !== undefined
  ) {
    throw precondition(operation, "domain_invariant", BLOCK_ENTITY_TYPE, left.id);
  }
  const tombstone = captureManuscriptBlockTombstone({
    blockId: right.id,
    manuscriptId: right.manuscriptId,
    formerChapterId: right.chapterId,
    formerOrderKey: right.orderKey,
    reason: MANUSCRIPT_TOMBSTONE_REASON.merged,
    replacementBlockId: left.id,
  });
  const beforeRedirect = mergeRedirect(rightBefore, anchor(left.id, "before"));
  const afterRedirect = mergeRedirect(rightAfter, anchor(left.id, "after"));
  if (
    !store.replaceBlock(captureParagraphBlock({ ...left, text })) ||
    !store.deleteBlock(right.id) ||
    !store.insertTombstone(tombstone) ||
    !store.insertAnchorRedirect(beforeRedirect) ||
    !store.insertAnchorRedirect(afterRedirect)
  ) {
    throw precondition(operation, "domain_invariant", BLOCK_ENTITY_TYPE, left.id);
  }
}

function applyBlockDelete(
  store: NovelMutableManuscriptRepository,
  operation: NovelOperation,
): void {
  const payload = capturePayloadObject(operation.payload, ["blockId"]);
  const blockId = captureManuscriptBlockId(payload.blockId);
  assertExpected(operation, [
    exists(BLOCK_ENTITY_TYPE, blockId),
    fieldDigest(BLOCK_ENTITY_TYPE, blockId, "text", expectedDigest(operation, 1)),
    fieldDigest(BLOCK_ENTITY_TYPE, blockId, "chapterId", expectedDigest(operation, 2)),
    fieldDigest(BLOCK_ENTITY_TYPE, blockId, "orderKey", expectedDigest(operation, 3)),
    absent(TOMBSTONE_ENTITY_TYPE, blockId),
  ]);
  assertBlockDigest(store, operation, blockId, "text");
  assertBlockDigest(store, operation, blockId, "chapterId");
  assertBlockDigest(store, operation, blockId, "orderKey");
  const block = requireBlock(store, operation, blockId);
  if (store.getTombstone(block.id) !== undefined) {
    throw precondition(operation, "domain_invariant", TOMBSTONE_ENTITY_TYPE, block.id);
  }
  const tombstone = captureManuscriptBlockTombstone({
    blockId: block.id,
    manuscriptId: block.manuscriptId,
    formerChapterId: block.chapterId,
    formerOrderKey: block.orderKey,
    reason: MANUSCRIPT_TOMBSTONE_REASON.deleted,
  });
  if (!store.deleteBlock(block.id) || !store.insertTombstone(tombstone)) {
    throw precondition(operation, "domain_invariant", BLOCK_ENTITY_TYPE, block.id);
  }
}

function applyAnchorRepair(
  store: NovelMutableManuscriptRepository,
  operation: NovelOperation,
): void {
  const payload = capturePayloadObject(operation.payload, ["source", "target"]);
  const source = captureManuscriptAnchor(payload.source);
  const target = captureManuscriptAnchor(payload.target);
  assertExpected(operation, [
    exists(TOMBSTONE_ENTITY_TYPE, source.blockId),
    exists(BLOCK_ENTITY_TYPE, target.blockId),
    absent(REDIRECT_ENTITY_TYPE, manuscriptAnchorKey(source)),
  ]);
  const tombstone = store.getTombstone(source.blockId);
  const targetBlock = store.getBlock(target.blockId);
  if (tombstone === undefined) {
    throw precondition(operation, "entity_missing", TOMBSTONE_ENTITY_TYPE, source.blockId);
  }
  if (targetBlock === undefined) {
    throw precondition(operation, "entity_missing", BLOCK_ENTITY_TYPE, target.blockId);
  }
  if (
    tombstone.manuscriptId !== targetBlock.manuscriptId ||
    store.getAnchorRedirect(source) !== undefined
  ) {
    throw precondition(operation, "domain_invariant", REDIRECT_ENTITY_TYPE, manuscriptAnchorKey(source));
  }
  const redirect = captureManuscriptAnchorRedirect({
    source,
    target,
    reason: MANUSCRIPT_REDIRECT_REASON.manualRepair,
    review: MANUSCRIPT_REPAIR_REVIEW.required,
  });
  if (!store.insertAnchorRedirect(redirect)) {
    throw precondition(operation, "domain_invariant", REDIRECT_ENTITY_TYPE, manuscriptAnchorKey(source));
  }
}

function isImmediateRightInsertion(
  store: NovelMutableManuscriptRepository,
  source: ParagraphBlock,
  right: ParagraphBlock,
): boolean {
  if (compareOrderKeys(source.orderKey, right.orderKey) >= 0) return false;
  const occupant = store.findBlockAt(
    source.manuscriptId,
    source.chapterId,
    right.orderKey,
  );
  if (occupant !== undefined) return false;
  const siblings = [...store.listBlocksInChapter(source.manuscriptId, source.chapterId)]
    .sort((left, candidate) => compareOrderKeys(left.orderKey, candidate.orderKey));
  const sourceIndex = siblings.findIndex((candidate) => candidate.id === source.id);
  const next = siblings[sourceIndex + 1];
  return sourceIndex >= 0 &&
    (next === undefined || compareOrderKeys(right.orderKey, next.orderKey) < 0);
}

function areAdjacent(
  store: NovelMutableManuscriptRepository,
  left: ParagraphBlock,
  right: ParagraphBlock,
): boolean {
  const siblings = [...store.listBlocksInChapter(left.manuscriptId, left.chapterId)]
    .sort((first, second) => compareOrderKeys(first.orderKey, second.orderKey));
  const leftIndex = siblings.findIndex((candidate) => candidate.id === left.id);
  return leftIndex >= 0 && siblings[leftIndex + 1]?.id === right.id;
}

function requireBlock(
  store: NovelMutableManuscriptRepository,
  operation: NovelOperation,
  id: ManuscriptBlockId,
): ParagraphBlock {
  const block = store.getBlock(id);
  if (block === undefined) {
    throw precondition(operation, "entity_missing", BLOCK_ENTITY_TYPE, id);
  }
  return block;
}

function assertBlockDigest(
  store: NovelMutableManuscriptRepository,
  operation: NovelOperation,
  id: ManuscriptBlockId,
  field: ManuscriptBlockDigestField,
): void {
  const expected = operation.expected.find(
    (candidate) =>
      candidate.kind === "field-digest" &&
      candidate.entityType === BLOCK_ENTITY_TYPE &&
      candidate.entityId === id &&
      candidate.fieldPath === field,
  );
  if (expected?.kind !== "field-digest") throw invalidPrecondition();
  const actual = store.getBlockDigest(id, field);
  if (actual === undefined) {
    throw precondition(operation, "entity_missing", BLOCK_ENTITY_TYPE, id);
  }
  if (actual !== expected.expectedDigest) {
    throw precondition(operation, "field_digest_mismatch", BLOCK_ENTITY_TYPE, id, field);
  }
}

function mergeRedirect(
  source: ManuscriptAnchor,
  target: ManuscriptAnchor,
) {
  return captureManuscriptAnchorRedirect({
    source,
    target,
    reason: MANUSCRIPT_REDIRECT_REASON.merge,
    review: MANUSCRIPT_REPAIR_REVIEW.required,
  });
}

function anchor(
  blockId: ManuscriptBlockId,
  boundary: "before" | "after",
): ManuscriptAnchor {
  return captureManuscriptAnchor({ blockId, boundary });
}

function assertExpected(
  operation: NovelOperation,
  expected: readonly NovelOperationPrecondition[],
): void {
  if (
    operation.expected.length !== expected.length ||
    operation.expected.some((value, index) => !samePrecondition(value, expected[index]))
  ) {
    throw invalidPrecondition();
  }
}

function samePrecondition(
  left: NovelOperationPrecondition | undefined,
  right: NovelOperationPrecondition | undefined,
): boolean {
  return left !== undefined && right !== undefined &&
    canonicalStringifyJson(left as unknown as JsonObject) ===
      canonicalStringifyJson(right as unknown as JsonObject);
}

function expectedDigest(operation: NovelOperation, index: number): string {
  const value = operation.expected[index];
  if (value?.kind !== "field-digest") throw invalidPrecondition();
  return value.expectedDigest;
}

function exists(entityType: string, entityId: string): NovelOperationPrecondition {
  return { kind: "entity-exists", entityType, entityId };
}

function absent(entityType: string, entityId: string): NovelOperationPrecondition {
  return { kind: "entity-absent", entityType, entityId };
}

function fieldDigest(
  entityType: string,
  entityId: string,
  fieldPath: string,
  expectedDigestValue: string,
): NovelOperationPrecondition {
  return {
    kind: "field-digest",
    entityType,
    entityId,
    fieldPath,
    expectedDigest: expectedDigestValue,
  };
}

function capturePayloadObject(
  payload: JsonObject,
  keys: readonly string[],
): Record<string, unknown> {
  const actual = Object.keys(payload).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw invalidPayload();
  }
  return payload;
}

function toJsonObject(value: object): JsonObject {
  return JSON.parse(
    canonicalStringifyJson(value as unknown as JsonObject),
  ) as JsonObject;
}

function precondition(
  operation: NovelOperation,
  failure: ConstructorParameters<typeof NovelOperationPreconditionError>[0],
  entityType: string,
  entityId: string,
  fieldPath?: string,
): NovelOperationPreconditionError {
  return new NovelOperationPreconditionError(
    failure,
    entityType,
    entityId,
    operation.operationId,
    fieldPath,
  );
}

function invalidPayload(): NovelProtocolValidationError {
  return new NovelProtocolValidationError(
    NOVEL_PROTOCOL_FAILURE.invalidOperation,
    "operationPayload",
  );
}

function invalidPrecondition(): NovelProtocolValidationError {
  return new NovelProtocolValidationError(
    NOVEL_PROTOCOL_FAILURE.invalidOperation,
    "operationPrecondition",
  );
}
